// Тот же стиль форматирования, что и formatCurrency в pharmup_mobile/src/theme/index.js
// (Intl.NumberFormat('ru-KZ', {style:'currency', currency:'KZT', minimumFractionDigits:0}))
// — не общий код (бэкенд и мобильное приложение — разные кодовые базы), но
// идентичное поведение, чтобы суммы в тексте уведомлений выглядели так же,
// как везде в приложении.
export const formatCurrency = (amount: number): string =>
    new Intl.NumberFormat('ru-KZ', {
        style: 'currency',
        currency: 'KZT',
        minimumFractionDigits: 0,
    }).format(amount)
