import { installDemoFetch } from './server';

/** 只在 VITE_DEMO 下加载：用本地模拟数据替换网络层。 */
export function installDemo() {
  installDemoFetch();
}
