type IconName = 'refresh' | 'trash' | 'sparkle';

const paths: Record<IconName, string> = {
  refresh: 'M20 7a8 8 0 0 0-13.5-2L3 8m0-5v5h5M4 17a8 8 0 0 0 13.5 2L21 16m0 5v-5h-5',
  trash: 'M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14M10 10v6m4-6v6',
  sparkle: 'M12 3c1.8 5.4 3.6 7.2 9 9-5.4 1.8-7.2 3.6-9 9-1.8-5.4-3.6-7.2-9-9 5.4-1.8 7.2-3.6 9-9Z',
};

export function Icon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={paths[name]} />
  </svg>;
}
