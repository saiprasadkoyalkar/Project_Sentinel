import { ReactNode } from 'react'
import otherPng from './ui/other.png'
import { Link, useLocation } from 'react-router-dom'
import { 
  LayoutDashboard, 
  AlertTriangle, 
  BarChart3
} from 'lucide-react'

interface LayoutProps {
  children: ReactNode
}

const Layout = ({ children }: LayoutProps) => {
  const location = useLocation()

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Alerts', href: '/alerts', icon: AlertTriangle },
    { name: 'Evaluations', href: '/evals', icon: BarChart3 },
  ]

  const isActive = (path: string) => location.pathname === path

  return (
    <div
      className="flex flex-col h-screen bg-gradient-to-br from-gray-50 to-gray-100"
      style={{
        backgroundImage: `url(${otherPng})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Top Navigation */}
      <header className="bg-gradient-to-r from-blue-700 to-blue-600 shadow-xl">
        <div className="flex items-center justify-between px-6 py-4">
          <h1 className="text-xl font-bold text-white tracking-tight">
            🛡️ Sentinel Support
          </h1>
          
          <nav className="flex items-center space-x-4">
            {navigation.map((item) => {
              const Icon = item.icon
              const isCurrentActive = isActive(item.href)
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  style={{ paddingLeft: '2rem', paddingRight: '2rem' }}
                  className={`flex items-center px-8 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                    isCurrentActive
                      ? 'bg-white/20 text-white shadow-lg backdrop-blur-sm border border-white/30'
                      : 'text-blue-100 hover:bg-white/10 hover:text-white hover:shadow-md'
                  }`}
                >
                  <Icon className={`w-4 h-4 mr-2 ${isCurrentActive ? 'text-white' : 'text-blue-200'}`} />
                  {item.name}
                </Link>
              )
            })}
          </nav>
        </div>
      </header>

      {/* Main content area */}
      <main className="flex-1 overflow-auto content-area">
        <div className="h-full">
          {children}
        </div>
      </main>
    </div>
  )
}

export default Layout