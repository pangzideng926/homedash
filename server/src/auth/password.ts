import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const HASH_PREFIX = 'scrypt';
const SALT_BYTES = 16;
const KEY_LENGTH = 64;
const HEX_PATTERN = /^[0-9a-f]+$/i;

function deriveKey(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(derivedKey);
    });
  });
}

/**
 * 使用 Node 内置 crypto.scrypt 生成密码哈希，格式为 scrypt$salt$hash（hex）。
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = await deriveKey(password, salt, KEY_LENGTH);
  return `${HASH_PREFIX}$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

/**
 * 校验明文密码与存储的 scrypt 哈希是否匹配，使用 timingSafeEqual 防止时序攻击。
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 3) {
    return false;
  }

  const [algorithm, saltHex, hashHex] = parts;
  if (
    algorithm !== HASH_PREFIX ||
    !saltHex ||
    !hashHex ||
    saltHex.length % 2 !== 0 ||
    hashHex.length % 2 !== 0 ||
    !HEX_PATTERN.test(saltHex) ||
    !HEX_PATTERN.test(hashHex)
  ) {
    return false;
  }

  const salt = Buffer.from(saltHex, 'hex');
  const expectedHash = Buffer.from(hashHex, 'hex');
  if (salt.length === 0 || expectedHash.length === 0) {
    return false;
  }

  const actualHash = await deriveKey(password, salt, expectedHash.length);
  if (actualHash.length !== expectedHash.length) {
    return false;
  }

  return timingSafeEqual(actualHash, expectedHash);
}
