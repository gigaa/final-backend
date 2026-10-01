import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User, UserDocument } from '../schemas/user.schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
    private mailService: MailService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.userModel.findOne({ email: dto.email });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.userModel.create({
      email: dto.email,
      password: hashedPassword,
      name: dto.name,
      isEmailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationExpires: verificationExpires,
    });

    await this.mailService.sendVerificationEmail(
      dto.email,
      dto.name ?? '',
      verificationToken,
    );

    return {
      message:
        'Registration successful. Please check your email to verify your account.',
    };
  }

  async verifyEmail(token: string) {
    const user = await this.userModel.findOne({
      emailVerificationToken: token,
    });

    if (!user) {
      throw new BadRequestException('Invalid verification link');
    }

    if (
      user.emailVerificationExpires &&
      user.emailVerificationExpires < new Date()
    ) {
      throw new BadRequestException(
        'Verification link has expired. Please register again.',
      );
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    await user.save();

    const accessToken = this.signToken(String(user._id), user.email);

    return {
      message: 'Email verified successfully.',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
      },
      access_token: accessToken,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.userModel.findOne({ email: dto.email });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(dto.password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 403 + email so the client can redirect to /pending-verification
    if (!user.isEmailVerified) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        email: user.email,
        message: 'Please verify your email address before logging in.',
      });
    }

    const token = this.signToken(String(user._id), user.email);

    return {
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
      },
      access_token: token,
    };
  }

  async resendVerification(email: string) {
    const user = await this.userModel.findOne({ email });

    // Don't reveal whether the email exists — always return success
    if (!user || user.isEmailVerified) {
      return {
        message:
          'If that email is registered and unverified, a new link has been sent.',
      };
    }

    // Throttle: block resend if a token was issued less than 60 seconds ago
    if (
      user.emailVerificationExpires &&
      user.emailVerificationExpires.getTime() - 24 * 60 * 60 * 1000 >
        Date.now() - 60 * 1000
    ) {
      throw new BadRequestException(
        'Please wait a moment before requesting another link.',
      );
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpires = verificationExpires;
    await user.save();

    await this.mailService.sendVerificationEmail(
      user.email,
      user.name ?? '',
      verificationToken,
    );

    return {
      message:
        'If that email is registered and unverified, a new link has been sent.',
    };
  }

  private signToken(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email });
  }
}
