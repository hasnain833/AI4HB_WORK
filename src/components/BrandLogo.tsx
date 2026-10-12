"use client";
export function BrandLogo({
  src,
  alt = "Logo",
  className = "",
  onDark = false,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  onDark?: boolean;
}) {
  if (src) return <img src={src} alt={alt} className={className} />;

  if (onDark) return <img src="/logo-light.svg" alt={alt} className={className} />;

  return (
    <>
      <img src="/logo.svg" alt={alt} className={`${className} dark:hidden`} />
      <img src="/logo-light.svg" alt="" aria-hidden="true" className={`${className} hidden dark:block`} />
    </>
  );
}
