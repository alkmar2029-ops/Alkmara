import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          cookiesToSet.forEach(({ name, value }: { name: string; value: string }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options?: Record<string, unknown> }) =>
            supabaseResponse.cookies.set(name, value, options as any)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith('/login') ||
    path.startsWith('/register') ||
    path === '/manifest.webmanifest' ||
    path === '/sw.js' ||
    path.startsWith('/icon-');

  // Teacher-only deployment (set NEXT_PUBLIC_TEACHER_ONLY=true on Vercel).
  // The exact same codebase runs locally with full admin access; the env var
  // hides admin routes on the public deployment.
  const TEACHER_ONLY = process.env.NEXT_PUBLIC_TEACHER_ONLY === 'true';
  if (TEACHER_ONLY) {
    // Block any /dashboard/* navigation on public deployment.
    if (path === '/' || path.startsWith('/dashboard')) {
      const url = request.nextUrl.clone();
      url.pathname = user ? '/teacher' : '/login';
      return NextResponse.redirect(url);
    }
    // Block admin-only API endpoints — teacher portal doesn't need them and
    // we want them invisible to the internet. Allowlist what teachers DO need.
    if (path.startsWith('/api/')) {
      const teacherApiAllowlist = [
        '/api/me/',                   // change password
        '/api/period-attendance',     // save + history
        '/api/periods',               // GET only — already RLS-restricted for writes
        '/api/grades',
        '/api/sections',
        '/api/students',
        '/api/settings',              // GET only — already RLS-restricted for writes
        '/api/teacher-registrations', // public submission
        '/api/public/',               // public info (school name, etc.)
        '/api/whatsapp/teacher-policy', // tiny boolean flags for teacher UI
        '/api/whatsapp/send-notes',   // teacher may send when admin toggle is ON
        '/api/student-notes',         // teachers record their own notes
        '/api/note-templates',        // GET — teachers pick from templates
      ];
      const allowed = teacherApiAllowlist.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'));
      if (!allowed) {
        return NextResponse.json({ error: 'Endpoint غير متاح في هذه النسخة' }, { status: 404 });
      }
    }
  }

  // Public APIs (no auth required) — kept narrow for safety.
  // The bulk-send worker is "public" only in the sense that the middleware
  // doesn't block it — it enforces its own auth via x-worker-secret inside
  // the route, and the secret is derived from SUPABASE_SERVICE_ROLE_KEY so
  // only server-side code that already has DB-admin power can call it.
  const publicApis = [
    '/api/teacher-registrations',
    '/api/public/',
    // Bulk-send worker is invoked internally without a session cookie. We
    // still gate it on a shared secret inside the route, so routing it past
    // the middleware auth check is safe. Each handler under this prefix
    // also runs its own auth (requireRole or secret check).
    '/api/whatsapp/bulk-jobs',
  ];
  const isPublicApi = publicApis.some((p) => path === p || path.startsWith(p + '/'));

  if (!user && path.startsWith('/api/') && !isPublicApi) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Page-redirect for unauthenticated users — but skip API paths, they were
  // already handled above. Without this exclusion, public API calls get
  // 307-redirected to /login and the client receives HTML instead of JSON.
  if (!user && !isPublic && !path.startsWith('/api/')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Determine role for routing decisions. Cheap: check JWT claim first, then
  // fall back to the user_profiles row.
  let role: string | null = null;
  if (user) {
    role = (user.app_metadata as { role?: string } | null)?.role ?? null;
    if (!role) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();
      role = (profile?.role as string) ?? null;
    }
  }

  // Logged-in user landing on /login → push to their proper home.
  if (user && path.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = role === 'teacher' ? '/teacher' : '/dashboard';
    return NextResponse.redirect(url);
  }

  // Teachers must stay inside /teacher (no admin dashboard access).
  if (user && role === 'teacher' && path.startsWith('/dashboard')) {
    const url = request.nextUrl.clone();
    url.pathname = '/teacher';
    return NextResponse.redirect(url);
  }

  // Admin/staff/viewer trying to load /teacher → bounce to dashboard
  // (avoids confusion if a non-teacher follows a teacher link).
  if (user && role && role !== 'teacher' && path.startsWith('/teacher')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
