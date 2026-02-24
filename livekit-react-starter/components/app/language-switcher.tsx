'use client';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="bg-background/90 border-input fixed top-4 right-4 z-50 flex items-center gap-1 rounded-full border p-1 backdrop-blur">
      <span className="text-muted-foreground px-2 text-[10px] font-semibold tracking-wide uppercase">
        {t('language')}
      </span>
      <Button
        size="sm"
        variant={locale === 'en' ? 'default' : 'ghost'}
        className="h-7 rounded-full px-2 text-xs"
        onClick={() => setLocale('en')}
      >
        EN
      </Button>
      <Button
        size="sm"
        variant={locale === 'tr' ? 'default' : 'ghost'}
        className="h-7 rounded-full px-2 text-xs"
        onClick={() => setLocale('tr')}
      >
        TR
      </Button>
    </div>
  );
}
