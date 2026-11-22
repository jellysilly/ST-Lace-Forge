import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const mk = (children: ReactNode, sw = 2) =>
  function Icon({ size = 16, ...rest }: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
        {children}
      </svg>
    );
  };

export const Hammer = mk(
  <>
    <path d="m14 4 6 6-3 3-6-6z" />
    <path d="m11 10-8 8 3 3 8-8" />
  </>,
);
export const Download = mk(<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3" />);
export const Upload = mk(<path d="M12 15V3m0 0L8 7m4-4 4 4M4 17v3h16v-3" />);
export const Plus = mk(<path d="M12 5v14M5 12h14" />);
export const Regen = mk(<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />);
export const Scissors = mk(
  <>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M8.6 7.6 20 18M8.6 16.4 20 6" />
  </>,
  1.8,
);
export const Trash = mk(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />, 1.8);
export const Key = mk(
  <>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 9-9M17 6l3 3" />
  </>,
);
export const Eye = mk(
  <>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
  1.8,
);
export const Arrow = mk(<path d="M5 12h14M13 6l6 6-6 6" />);
export const Up = mk(<path d="m6 15 6-6 6 6" />);
export const Down = mk(<path d="m6 9 6 6 6-6" />);
export const Copy = mk(
  <>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </>,
  1.8,
);
export const X = mk(<path d="M6 6l12 12M18 6 6 18" />, 2.4);
export const Stop = mk(<rect x="6" y="6" width="12" height="12" rx="2" />);
export const Pin = mk(<path d="M12 2v8M8 6h8M6 14h12l-2-4H8zM12 14v8" />, 1.6);
export const Split = mk(<path d="M4 6h16M4 12h10M4 18h6M17 15l3 3-3 3" />, 1.8);
export const Book = mk(<path d="M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4zM18 20h2V8M8 8h6M8 12h6" />, 1.6);

export function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#f2ede6" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 9h14v3h-4c-2 0-3 1-3 3v1h-4v-1c0-2-1-3-3-3-2.5 0-4-1.3-5-3h5z" />
      <path d="M7.5 20h9l-1.5-4h-6z" />
      <path d="M12 2.5v2.5M16.5 3.5l-1.2 2.2M7.5 3.5l1.2 2.2" stroke="#e08a4f" />
    </svg>
  );
}

const SOCIAL: Record<string, ReactNode> = {
  telegram: (
    <>
      <path d="M21 4 3 11l6 2 2 6 3-4 5 4z" />
      <path d="m9 13 12-9" />
    </>
  ),
  discord: <path d="M4 5h16v11H9l-5 4z" />,
  github: <path d="m8 6-6 6 6 6M16 6l6 6-6 6" />,
  boosty: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  youtube: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <path d="m10 9 5 3-5 3z" />
    </>
  ),
  x: <path d="M4 4l16 16M20 4 4 20" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
};

export function SocialIcon({ name }: { name: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {SOCIAL[name] ?? SOCIAL.link}
    </svg>
  );
}
