import { Languages, Moon, Sun } from 'lucide-react';
import type { Locale } from '../lib/locale';
import { Modal } from './shared';

export function PreferencesModal({ locale, theme, onLocaleToggle, onThemeChange, onClose }: { locale: Locale; theme: 'light' | 'dark'; onLocaleToggle: () => void; onThemeChange: (theme: 'light' | 'dark') => void; onClose: () => void }) {
  return <Modal title={locale === 'en' ? 'Preferences' : '偏好设置'} onClose={onClose}>
    <div className="preferences-form">
      <section className="preference-row"><div><strong>{locale === 'en' ? 'Appearance' : '外观主题'}</strong><span>{locale === 'en' ? 'Choose the workspace appearance.' : '选择工作台显示主题。'}</span></div><div className="preference-options" role="group" aria-label={locale === 'en' ? 'Appearance theme' : '外观主题'}><button type="button" className={`preference-option ${theme === 'light' ? 'active' : ''}`} onClick={() => onThemeChange('light')}><Sun size={15} />{locale === 'en' ? 'Light' : '浅色'}</button><button type="button" className={`preference-option ${theme === 'dark' ? 'active' : ''}`} onClick={() => onThemeChange('dark')}><Moon size={15} />{locale === 'en' ? 'Dark' : '深色'}</button></div></section>
      <section className="preference-row"><div><strong>{locale === 'en' ? 'Language' : '界面语言'}</strong><span>{locale === 'en' ? 'Change labels across the workspace.' : '切换工作台界面文案。'}</span></div><button type="button" className="button secondary" onClick={onLocaleToggle}><Languages size={15} />{locale === 'en' ? '切换中文' : 'Switch to English'}</button></section>
    </div>
  </Modal>;
}
