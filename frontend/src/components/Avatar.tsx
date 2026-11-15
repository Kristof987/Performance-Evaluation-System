import { useState } from 'react';
import { mediaUrl } from '../config';
import { getUserInitials } from '../pages/layout/sidebar-user';

/** Profile photo with an initials fallback when there is no photo or it fails to load. */
export default function Avatar({ name, photo, className }: { name: string; photo: string | null | undefined; className: string }) {
  const src = mediaUrl(photo);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return <div className={className}>
    {src && failedSrc !== src
      ? <img src={src} alt="" onError={() => setFailedSrc(src)} />
      : <span aria-hidden="true">{getUserInitials(name)}</span>}
  </div>;
}
