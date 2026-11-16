import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

const ARGON2ID_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB (recomendación OWASP para Argon2id)
  timeCost: 2,
  parallelism: 1,
  raw: false,
} as const;

@Injectable()
export class PasswordHasher {
  private dummyHashPromise: Promise<string> | null = null;

  private getDummyHash(): Promise<string> {
    if (!this.dummyHashPromise) {
      this.dummyHashPromise = argon2.hash(
        'contrasena-ficticia-anti-enumeracion-de-tiempos-99!',
        ARGON2ID_OPTIONS,
      );
    }
    return this.dummyHashPromise;
  }

  async hashPassword(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword, ARGON2ID_OPTIONS);
  }

  /**
   * Verifica contraseña con Argon2id. Si `storedHash` es nulo (usuario inexistente o solo Google),
   * ejecuta igualmente el cálculo Argon2id contra un hash ficticio para mitigar enumeración por timing.
   */
  async verifyPasswordTimingSafe(
    plainPassword: string,
    storedHash: string | null,
  ): Promise<boolean> {
    const targetHash = storedHash ?? (await this.getDummyHash());
    try {
      const matches = await argon2.verify(targetHash, plainPassword);
      return storedHash !== null && matches;
    } catch {
      return false;
    }
  }
}
