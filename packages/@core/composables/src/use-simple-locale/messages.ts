import type policy from '../../../../../locale-policy.json';
export type Locale = keyof typeof policy.languages;

export const messages: Record<Locale, Record<string, string>> = {
  "en-US": {
    "cancel": "Cancel",
    "collapse": "Collapse",
    "confirm": "Confirm",
    "expand": "Expand",
    "prompt": "Information",
    "reset": "Reset",
    "submit": "Submit"
  },
  "zh-CN": {
    "cancel": "取消",
    "collapse": "收起",
    "confirm": "确认",
    "expand": "展开",
    "prompt": "提示",
    "reset": "重置",
    "submit": "提交"
  },
  "fr-FR": {
    "cancel": "Annuler",
    "collapse": "Réduire",
    "confirm": "Confirmer",
    "expand": "Développer",
    "prompt": "Information",
    "reset": "Réinitialiser",
    "submit": "Envoyer"
  },
  "ru-RU": {
    "cancel": "Отмена",
    "collapse": "Свернуть",
    "confirm": "Подтвердить",
    "expand": "Развернуть",
    "prompt": "Уведомление",
    "reset": "Сбросить",
    "submit": "Отправить"
  },
  "ja-JP": {
    "cancel": "キャンセル",
    "collapse": "折りたたむ",
    "confirm": "確認",
    "expand": "展開",
    "prompt": "お知らせ",
    "reset": "リセット",
    "submit": "送信"
  },
  "ko-KR": {
    "cancel": "취소",
    "collapse": "접기",
    "confirm": "확인",
    "expand": "펼치기",
    "prompt": "알림",
    "reset": "초기화",
    "submit": "제출"
  },
  "es-ES": {
    "cancel": "Cancelar",
    "collapse": "Contraer",
    "confirm": "Confirmar",
    "expand": "Expandir",
    "prompt": "Aviso",
    "reset": "Restablecer",
    "submit": "Enviar"
  },
  "ar-EG": {
    "cancel": "إلغاء",
    "collapse": "طي",
    "confirm": "تأكيد",
    "expand": "توسيع",
    "prompt": "تنبيه",
    "reset": "إعادة تعيين",
    "submit": "إرسال"
  }
};

export const getMessages = (locale: Locale) => messages[locale];
