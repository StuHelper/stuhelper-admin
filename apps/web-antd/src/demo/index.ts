import { MessagesSquare, Search } from 'lucide-vue-next';

import { menus } from '#/menus';
import { router } from '#/router';

import { installDemoFetch } from './server';
import './demo.css';

/** 只在 VITE_DEMO 下加载：替换网络层，登记后台原型页面和菜单。 */
export function installDemo() {
  installDemoFetch();
  const pages = [
    { name: 'DemoLookup', path: 'system/lookup', title: '全站信息查询', icon: Search, load: () => import('./pages/Lookup.vue') },
    { name: 'DemoQQ', path: 'qq', title: 'QQ 群管理', icon: MessagesSquare, load: () => import('./pages/QQ.vue') },
  ];
  for (const page of pages) {
    router.addRoute('Root', { name: page.name, path: page.path, component: page.load, meta: { title: page.title } });
    menus.push({ name: page.title, path: `/${page.path}`, icon: page.icon });
  }
}
