import LoginForm from './login-form'

interface Props {
  searchParams: { next?: string; error?: string }
}

export default function LoginPage({ searchParams }: Props) {
  const next = searchParams.next ?? '/dashboard'
  const hasError = searchParams.error === 'auth_failed'

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="text-4xl">✨</span>
          <h1 className="mt-3 text-2xl font-bold text-white">Magic Engine</h1>
          <p className="mt-1 text-sm text-gray-500">Internal admin dashboard</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-xl">
          <LoginForm next={next} authFailed={hasError} />
        </div>

        <p className="mt-6 text-center text-xs text-gray-600">
          Magic Lab · Admin access only
        </p>
      </div>
    </div>
  )
}
