import { confirm } from '@vben/common-ui';

// Unsaved edits and requests with unknown results ask through the Vben dialog,
// so the prompt follows the app theme, language and RTL direction.
// Cancelling, closing the dialog or a dialog failure all keep the user on the page.
export async function confirmLeave(content: string): Promise<boolean> {
  try {
    await confirm({ content, icon: 'warning' });
    return true;
  } catch {
    return false;
  }
}
