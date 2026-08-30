import { Crown, User } from 'lucide-react'

export interface AdminUser {
  id: string
  email: string
  displayName: string
  role: 'user' | 'admin'
  status: 'active' | 'suspended'
  maxProjects: number | null
  lastLoginAt: number | null
  createdAt: number
}

export type RoleOption = 'user' | 'admin'

export const roleOptions: Array<{ value: RoleOption; label: string; icon: typeof User }> = [
  { value: 'user', label: 'User', icon: User },
  { value: 'admin', label: 'Admin', icon: Crown },
]
