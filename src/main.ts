import './style.css';
import { createApp } from 'vue';
import { createI18n } from 'vue-i18n';
import App from './App.vue';
import Notifications from './components/Notifications.vue';
import { LOCALE_MESSAGES } from './locales';

const supported = ['en', 'es', 'fr', 'it', 'de', 'pt', 'nl'] as const;
type SupportedLang = (typeof supported)[number];
// Forzar español como idioma de la interfaz
let savedLang: SupportedLang = 'es';
localStorage.setItem('language', savedLang);

const i18n = createI18n({
  legacy: false,
  locale: savedLang,
  messages: LOCALE_MESSAGES
} as any);

const app = createApp(App);

app.component('Notifications', Notifications as any);

app.use(i18n).mount('#app');
