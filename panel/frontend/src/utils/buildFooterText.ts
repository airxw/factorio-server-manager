import { BUILD_ID } from '../buildInfo';

type BuildFooterVariant = 'marketing' | 'standard';

interface BuildFooterTextOptions {
  variant?: BuildFooterVariant;
  version?: string | null;
  year?: number;
}

export function getBuildFooterText({
  variant = 'standard',
  version,
  year = new Date().getFullYear(),
}: BuildFooterTextOptions = {}): string {
  if (variant === 'marketing') {
    const versionText = version ? ` v${version}` : '';
    return `© ${year} GameServer Panel${versionText} · BUILD ${BUILD_ID} · 开源免费`;
  }

  return `© ${year} GSP · Game Server Panel · BUILD ${BUILD_ID}`;
}

