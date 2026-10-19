"use client";
export function BrandLogo({
  alt = "Logo",
  className = "",
  onDark = false,
}: {
  alt?: string;
  className?: string;
  onDark?: boolean;
}) {
  if (onDark) return <img src="/logo-light.svg" alt={alt} className={className} />;

  return (
    <>
      <img src="/logo.svg" alt={alt} className={`${className} dark:hidden`} />
      <img src="/logo-light.svg" alt="" aria-hidden="true" className={`${className} hidden dark:block`} />
    </>
  );
}
