import { hashPassword } from '../auth/password.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const password = args[0] === '--' ? args[1] : args[0];

  if (!password) {
    console.error('用法：pnpm --filter server hash-password <密码>');
    process.exitCode = 1;
    return;
  }

  const hash = await hashPassword(password);
  console.log(hash);
}

main().catch((err: unknown) => {
  console.error('生成密码哈希失败：', err);
  process.exitCode = 1;
});
