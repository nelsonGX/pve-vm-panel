import NextAuth from 'next-auth'
import Discord from 'next-auth/providers/discord'
import type { OAuth2Config } from 'next-auth/providers'

// ---------------------------------------------------------------------------
// Auth mode switch (env-driven)
//   AUTH_MODE=discord       → plain Discord OAuth (default, original behaviour)
//   AUTH_MODE=friend-group  → Friend Group Auth: Discord-gated OAuth2 + PKCE,
//                             only members with `allowed === true` may sign in.
// The Friend Group provider keeps the provider id "discord" so the login
// button, callback URL (/api/auth/callback/discord) and session shape are
// identical in both modes — only the upstream identity provider changes.
// ---------------------------------------------------------------------------

const AUTH_MODE = process.env.AUTH_MODE ?? 'discord'
const USE_FRIEND_GROUP = AUTH_MODE === 'friend-group'
const FGA_BASE = process.env.AUTH_BASE_URL ?? 'https://group.nelsongx.com'

// Raw userinfo payload from Friend Group Auth (scopes: identify, roles).
interface FgaProfile {
  sub: string
  id: string
  username?: string
  global_name?: string
  avatar?: string | null
  discord_id: string
  allowed?: boolean
  in_guild?: boolean
}

// Shape shared by both providers' raw profiles, used in the jwt callback.
interface RawProfile {
  id?: string
  discord_id?: string
  username?: string
  global_name?: string
  avatar?: string | null
}

function discordAvatarUrl(p: FgaProfile): string | null {
  if (!p.avatar) return null
  if (p.avatar.startsWith('http')) return p.avatar
  const ext = p.avatar.startsWith('a_') ? 'gif' : 'png'
  return `https://cdn.discordapp.com/avatars/${p.discord_id}/${p.avatar}.${ext}`
}

const friendGroupProvider: OAuth2Config<FgaProfile> = {
  id: 'discord',
  name: 'Discord',
  type: 'oauth',
  clientId: process.env.AUTH_CLIENT_ID,
  clientSecret: process.env.AUTH_CLIENT_SECRET,
  checks: ['pkce', 'state'],
  authorization: {
    url: `${FGA_BASE}/oauth/authorize`,
    params: { scope: 'identify roles' },
  },
  token: `${FGA_BASE}/api/oauth/token`,
  userinfo: `${FGA_BASE}/api/oauth/userinfo`,
  profile(profile) {
    return {
      id: profile.sub,
      name: profile.global_name ?? profile.username ?? profile.discord_id,
      image: discordAvatarUrl(profile),
    }
  },
  style: { bg: '#5865F2', text: '#fff' },
}

export const { handlers, auth } = NextAuth({
  providers: [
    USE_FRIEND_GROUP
      ? friendGroupProvider
      : Discord({
          clientId: process.env.DISCORD_CLIENT_ID!,
          clientSecret: process.env.DISCORD_CLIENT_SECRET!,
        }),
  ],
  callbacks: {
    async signIn({ profile }) {
      // Friend Group Auth: only let group members in. Re-checked on every
      // login, since a user can lose access (left the server / lost the role).
      if (USE_FRIEND_GROUP) {
        return (profile as FgaProfile | undefined)?.allowed === true
      }
      return true
    },
    async jwt({ token, profile }) {
      if (profile) {
        const p = profile as RawProfile
        // discord_id (Friend Group Auth) or id (raw Discord) — both are the
        // stable Discord user id the backend keys users on.
        token.discordId = (p.discord_id ?? p.id)!
        token.discordUsername = p.username ?? p.global_name ?? token.name ?? token.discordId
        token.avatar = p.avatar ?? null
      }
      return token
    },
    async session({ session, token }) {
      session.user.discordId = token.discordId as string
      session.user.discordUsername = token.discordUsername as string
      session.user.avatar = (token.avatar as string | null | undefined) ?? null
      return session
    },
  },
})
