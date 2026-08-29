/** @type {import('next').NextConfig} */
const nextConfig = {
  // Was `true` - meaning a broken TypeScript build could deploy straight to
  // Vercel with no warning. `tsc --noEmit --strict` currently passes clean,
  // so this now actually protects that: Vercel will fail the build (not
  // silently ship) if a future change introduces a type error.
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;