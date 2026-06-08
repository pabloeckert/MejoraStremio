<script setup>
import { ref } from 'vue';
import Header from './components/Header.vue';
import DarkModeToggle from './components/DarkModeToggle.vue';
import Backup from './components/Backup.vue';
import Footer from './components/Footer.vue';
import Authentication from './components/Authentication.vue';
import Notifications from './components/Notifications.vue';
import PabloFreeWizard from './components/PabloFreeWizard.vue';

const authKey = ref('');

function setAuthKey(payload) {
  if (!payload || !payload.platform) return;
  authKey.value = payload.key || '';
}
</script>

<template>
  <header>
    <div class="flex justify-end items-center mt-4 px-4">
      <DarkModeToggle />
    </div>
    <Header
      addonName="Mi Setup — Stremio"
      addonSummary="Setup 100% gratuito para Stremio con metadata profunda, catálogos latinos y subtítulos en español."
      addonLogo="logo.png"
    />
  </header>
  <main class="max-w-4xl mx-auto">
    <Notifications />
    <Authentication
      platform="stremio"
      @auth-key="setAuthKey"
    />
    <Backup platform="stremio" :authKey="authKey" />
    <PabloFreeWizard platform="stremio" :authKey="authKey" />
  </main>
  <footer>
    <Footer />
  </footer>
</template>
