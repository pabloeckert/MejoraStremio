import './style.css';
import { createApp } from 'vue';
import { createI18n } from 'vue-i18n';
import App from './App.vue';
import Notifications from './components/Notifications.vue';
import { LOCALE_MESSAGES } from './locales';

// Forzar español como idioma de la interfaz
localStorage.setItem('language', 'es');

const i18n = createI18n({
  legacy: false,
  locale: 'es',
  messages: LOCALE_MESSAGES
} as any);

const app = createApp(App);

app.component('Notifications', Notifications as any);

app.use(i18n).mount('#app');
