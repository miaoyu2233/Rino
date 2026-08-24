export const INSTALLATION_CODE_LENGTH = 8;

const INSTALLATION_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const INSTALLATION_CODE_PATTERN = /^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{8}$/u;
const UNBIASED_RANDOM_BYTE_LIMIT =
  Math.floor(256 / INSTALLATION_CODE_ALPHABET.length) *
  INSTALLATION_CODE_ALPHABET.length;
const MAXIMUM_GENERATION_ATTEMPTS = 128;

export type RandomBytesProvider = (length: number) => Uint8Array;

function secureRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function isInstallationCode(value: unknown): value is string {
  return typeof value === "string" && INSTALLATION_CODE_PATTERN.test(value);
}

export function generateInstallationCode(
  randomBytes: RandomBytesProvider = secureRandomBytes,
): string {
  for (let attempt = 0; attempt < MAXIMUM_GENERATION_ATTEMPTS; attempt += 1) {
    const source = randomBytes(INSTALLATION_CODE_LENGTH * 2);
    let code = "";
    for (const byte of source) {
      if (byte >= UNBIASED_RANDOM_BYTE_LIMIT) {
        continue;
      }
      const character =
        INSTALLATION_CODE_ALPHABET[byte % INSTALLATION_CODE_ALPHABET.length];
      if (character === undefined) {
        continue;
      }
      code += character;
      if (code.length === INSTALLATION_CODE_LENGTH) {
        break;
      }
    }
    if (isInstallationCode(code)) {
      return code;
    }
  }
  throw new Error(
    "Unable to generate an installation code from secure randomness.",
  );
}
