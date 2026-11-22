/**
 * Site owner settings. Edit the links here — a social with an empty `url` is hidden everywhere.
 * `icon` is one of: telegram, discord, github, boosty, youtube, x, mail, link.
 */
export const AUTHOR = 'jellysilly';

export const SOCIALS: { name: string; url: string; icon: string }[] = [
  { name: 'Telegram', url: 'https://t.me/laratavo', icon: 'telegram' },
  { name: 'Discord', url: '', icon: 'discord' },
  { name: 'GitHub', url: 'https://github.com/jellysilly', icon: 'github' },
  { name: 'Boosty', url: '', icon: 'boosty' },
];

export const activeSocials = () => SOCIALS.filter((s) => s.url.trim());
