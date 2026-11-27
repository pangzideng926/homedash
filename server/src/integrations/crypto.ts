import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { EncryptedFieldValue } from './types.js';

export const INTEGRATIONS_HKDF_INFO = 'homedash-integrations-v1';

const AES_ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BYTES = 16;

export class IntegrationsCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationsCryptoError';
  }
}

/**
 * 派生 32 字节 AES-256-GCM 密钥：
 * - 若配置了 CONFIG_ENCRYPTION_KEY，使用其作为输入密钥材料通过 HKDF-SHA256 派生（支持任意 >=32 字符文本）；
 * - 否则使用 SESSION_SECRET 通过 HKDF-SHA256 派生，info 固定为 "homedash-integrations-v1"。
 */
export function deriveIntegrationKey(options: {
  configEncryptionKey?: string;
  sessionSecret: string;
}): Buffer {
  const rawMaterial = options.configEncryptionKey?.trim()
    ? options.configEncryptionKey
    : options.sessionSecret;
  if (!rawMaterial || rawMaterial.length < 32) {
    throw new IntegrationsCryptoError('加密密钥长度不足（至少需要 32 个字符）');
  }

  const derived = hkdfSync(
    'sha256',
    Buffer.from(rawMaterial, 'utf-8'),
    Buffer.alloc(0),
    Buffer.from(INTEGRATIONS_HKDF_INFO, 'utf-8'),
    KEY_LENGTH_BYTES,
  );

  return Buffer.from(derived);
}

/**
 * 使用 AES-256-GCM 加密敏感字段，每次生成独立随机 12 字节 IV。
 */
export function encryptSecret(plaintext: string, key: Buffer): EncryptedFieldValue {
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new IntegrationsCryptoError('加密密钥长度无效');
  }

  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64'),
  };
}

/**
 * 解密 AES-256-GCM 密文；任何篡改或密钥不匹配都会抛出不含明文/密文的中文异常。
 */
export function decryptSecret(encrypted: EncryptedFieldValue, key: Buffer): string {
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new IntegrationsCryptoError('解密密钥长度无效');
  }
  if (!encrypted || encrypted.v !== 1) {
    throw new IntegrationsCryptoError('集成凭据密文版本不受支持');
  }

  let iv: Buffer;
  let tag: Buffer;
  let data: Buffer;
  try {
    iv = Buffer.from(encrypted.iv, 'base64');
    tag = Buffer.from(encrypted.tag, 'base64');
    data = Buffer.from(encrypted.data, 'base64');
  } catch {
    throw new IntegrationsCryptoError('集成凭据密文编码格式无效');
  }

  if (iv.length !== IV_LENGTH_BYTES || tag.length !== TAG_LENGTH_BYTES) {
    throw new IntegrationsCryptoError('集成凭据密文结构无效或已损坏');
  }

  try {
    const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    return plaintext.toString('utf-8');
  } catch {
    throw new IntegrationsCryptoError('集成凭据解密失败，请检查加密密钥或凭据文件是否被篡改');
  }
}
