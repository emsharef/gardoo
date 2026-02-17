"use client";

import { trpc } from "@/lib/trpc";

function isDirectUrl(src: string): boolean {
  return src.startsWith("data:") || src.startsWith("http://") || src.startsWith("https://");
}

interface PhotoProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string | null | undefined;
}

/**
 * Drop-in <img> replacement that resolves R2 keys to signed URLs.
 * - null/undefined src → renders nothing
 * - data: or http(s) URLs → used directly (backwards compat for legacy base64)
 * - Otherwise → treated as R2 key, resolved via photos.getReadUrl query
 */
export function Photo({ src, alt, ...rest }: PhotoProps) {
  const isR2Key = !!src && !isDirectUrl(src);

  const readUrlQuery = trpc.photos.getReadUrl.useQuery(
    { key: src! },
    {
      enabled: isR2Key,
      staleTime: 50 * 60 * 1000, // 50 min (signed URL valid for 60 min)
      gcTime: 55 * 60 * 1000,
    },
  );

  if (!src) return null;

  const resolvedSrc = isR2Key ? readUrlQuery.data?.url : src;

  if (isR2Key && !resolvedSrc) {
    // Still loading the signed URL
    return null;
  }

  /* eslint-disable-next-line @next/next/no-img-element */
  return <img src={resolvedSrc} alt={alt ?? ""} {...rest} />;
}
