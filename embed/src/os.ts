function macOSName(major: number): string {
  if (major === 15) return 'macOS 15 Sequoia';
  if (major === 14) return 'macOS 14 Sonoma';
  if (major === 13) return 'macOS 13 Ventura';
  if (major === 12) return 'macOS 12 Monterey';
  return major > 0 ? `macOS ${major}` : 'macOS';
}

export async function detectOperatingSystem(): Promise<string> {
  const ua = navigator.userAgent;
  const uaData = (navigator as Navigator & {
    userAgentData?: {
      platform?: string;
      getHighEntropyValues?: (hints: string[]) => Promise<{ platform?: string; platformVersion?: string }>;
    };
  }).userAgentData;
  let platform = uaData?.platform || navigator.platform || '';
  let platformVersion = '';

  try {
    const values = await uaData?.getHighEntropyValues?.(['platform', 'platformVersion']);
    platform = values?.platform || platform;
    platformVersion = values?.platformVersion || '';
  } catch {
    // Reduced user-agent data is enough for the fallback detector.
  }

  const android = ua.match(/Android[ /](\d{1,2})/i);
  if (android) return `Android ${android[1]}`;

  const ios = ua.match(/(?:iPhone )?OS (\d{1,2})[_\d]*/i);
  if (/iPad/i.test(ua) && ios) return `iPadOS ${ios[1]}`;
  if (ios) return `iOS ${ios[1]}`;

  if (/Windows/i.test(platform) || /Windows NT/i.test(ua)) {
    const platformMajor = Number.parseInt(platformVersion.split('.')[0] || '', 10);
    if (Number.isFinite(platformMajor)) return platformMajor >= 13 ? 'Windows 11' : 'Windows 10';
    if (/Windows NT 6\.3/i.test(ua)) return 'Windows 8.1';
    if (/Windows NT 6\.2/i.test(ua)) return 'Windows 8';
    if (/Windows NT 6\.1/i.test(ua)) return 'Windows 7';
    return 'Windows 10';
  }

  if (/CrOS/i.test(ua)) return 'ChromeOS';
  if (/Ubuntu/i.test(ua)) return 'Ubuntu';
  if (/Arch(?: Linux)?/i.test(ua)) return 'Arch Linux';
  if (/Deepin/i.test(ua)) return 'Deepin';
  if (/Fedora/i.test(ua)) return 'Fedora';

  if (/macOS|Mac/i.test(platform) || /Mac OS X/i.test(ua)) {
    const highEntropyMajor = Number.parseInt(platformVersion.split('.')[0] || '', 10);
    const uaMajor = Number.parseInt(ua.match(/Mac OS X (\d{1,2})/)?.[1] || '', 10);
    return macOSName(Number.isFinite(highEntropyMajor) ? highEntropyMajor : uaMajor);
  }

  if (/Linux/i.test(platform) || /Linux/i.test(ua)) return 'Linux';
  return '未知系统';
}

