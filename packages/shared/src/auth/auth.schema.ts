import { z } from 'zod';
import { NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from './nickname.js';

export const EmailInputSchema = z
  .string()
  .trim()
  .min(5)
  .max(254)
  .email('Formato de correo electrónico inválido')
  .transform((val) => val.toLowerCase());

export const PasswordInputSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(128, 'La contraseña no puede superar 128 caracteres')
  .refine(
    (pw) => /[a-zA-Z]/.test(pw) && /[0-9]/.test(pw),
    'La contraseña debe incluir al menos una letra y un número',
  );

export const RawNicknameInputSchema = z
  .string()
  .trim()
  .min(NICKNAME_MIN_LENGTH)
  .max(NICKNAME_MAX_LENGTH);

export const UserRoleSchema = z.enum(['PLAYER', 'SUPPORT', 'MODERATOR', 'ADMIN']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const AccountStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED']);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export const GuestCreateRequestSchema = z
  .object({
    deviceName: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
export type GuestCreateRequest = z.infer<typeof GuestCreateRequestSchema>;

export const RegisterRequestSchema = z
  .object({
    email: EmailInputSchema,
    password: PasswordInputSchema,
    nickname: RawNicknameInputSchema,
    captchaToken: z.string().trim().min(1).max(2048).optional(),
    deviceName: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const PromoteGuestRequestSchema = z
  .object({
    email: EmailInputSchema,
    password: PasswordInputSchema,
    nickname: RawNicknameInputSchema.optional(),
    captchaToken: z.string().trim().min(1).max(2048).optional(),
  })
  .strict();
export type PromoteGuestRequest = z.infer<typeof PromoteGuestRequestSchema>;

export const LoginRequestSchema = z
  .object({
    email: EmailInputSchema,
    password: z.string().min(1).max(128),
    captchaToken: z.string().trim().min(1).max(2048).optional(),
    deviceName: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const GoogleAuthRequestSchema = z
  .object({
    idToken: z.string().trim().min(10).max(4096),
    deviceName: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
export type GoogleAuthRequest = z.infer<typeof GoogleAuthRequestSchema>;

export const LogoutRequestSchema = z
  .object({
    allDevices: z.boolean().optional().default(false),
  })
  .strict();
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

export const ForgotPasswordRequestSchema = z
  .object({
    email: EmailInputSchema,
  })
  .strict();
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const ResetPasswordRequestSchema = z
  .object({
    token: z.string().trim().min(20).max(256),
    newPassword: PasswordInputSchema,
  })
  .strict();
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

export const VerifyEmailRequestSchema = z
  .object({
    token: z.string().trim().min(20).max(256),
  })
  .strict();
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

export const ResendVerificationRequestSchema = z
  .object({
    email: EmailInputSchema,
  })
  .strict();
export type ResendVerificationRequest = z.infer<typeof ResendVerificationRequestSchema>;

export const AuthUserSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable(),
  emailVerified: z.boolean(),
  nickname: z.string(),
  isGuest: z.boolean(),
  role: UserRoleSchema,
  status: AccountStatusSchema,
  createdAt: z.string(),
});
export type AuthUserSummary = z.infer<typeof AuthUserSummarySchema>;

export const AuthSessionResponseSchema = z.object({
  user: AuthUserSummarySchema,
  sessionId: z.string().uuid(),
  expiresAt: z.string(),
});
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;

export const NonEnumeratingAckResponseSchema = z.object({
  accepted: z.literal(true),
  message: z.string().min(1),
});
export type NonEnumeratingAckResponse = z.infer<typeof NonEnumeratingAckResponseSchema>;

export const SessionDeviceItemSchema = z.object({
  id: z.string().uuid(),
  deviceName: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  expiresAt: z.string(),
  isCurrent: z.boolean(),
});
export type SessionDeviceItem = z.infer<typeof SessionDeviceItemSchema>;

export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionDeviceItemSchema),
});
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

export const WsTicketResponseSchema = z.object({
  ticket: z.string().min(20),
  expiresAt: z.number().int().positive(),
});
export type WsTicketResponse = z.infer<typeof WsTicketResponseSchema>;
