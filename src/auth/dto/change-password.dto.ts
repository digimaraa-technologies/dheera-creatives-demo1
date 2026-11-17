import {
  IsString,
  Length,
  MinLength,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';
import {
  MAX_PASSWORD_BYTES,
  isPasswordWithinBcryptLimit,
} from '../password';

export const MIN_PASSWORD_LENGTH = 12;

/** Rejects strings that bcrypt would silently truncate at 72 UTF-8 bytes. */
function IsWithinBcryptLimit(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isWithinBcryptLimit',
      target: object.constructor,
      propertyName,
      options: {
        message: `newPassword must be at most ${MAX_PASSWORD_BYTES} UTF-8 bytes`,
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && isPasswordWithinBcryptLimit(value),
      },
    });
  };
}

export class ChangePasswordDto {
  // Legacy credentials may be longer than the new 72-byte cap, so the current
  // password is bounded like login instead of by the new-password rules.
  @IsString()
  @Length(1, 128)
  currentPassword!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters`,
  })
  @IsWithinBcryptLimit()
  newPassword!: string;

  @IsString()
  @Length(1, 128)
  confirmPassword!: string;
}
