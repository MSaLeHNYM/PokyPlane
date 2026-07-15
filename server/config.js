import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 7777),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost',
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://pokyplane:pokyplane_secret@localhost:5444/pokyplane',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-me!!',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me!!',
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  },
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@pokyplane.local',
    password: process.env.ADMIN_PASSWORD || 'Admin123!',
    username: process.env.ADMIN_USERNAME || 'admin',
  },
  presence: {
    onlineTtlSec: 90,
  },
};

/** 10 arcade pilot portraits — sync IDs with src/avatars.js */
export const PROFILE_AVATARS = [
  { id: 'pilot_1', label: 'Jake — Sky Ace', gender: 'male', region: 'american', color: '#ff6b4a', emoji: '✈️' },
  { id: 'pilot_2', label: 'Ken — Cloud Rider', gender: 'male', region: 'asian', color: '#3b82f6', emoji: '✈️' },
  { id: 'pilot_3', label: 'Amir — Desert Hawk', gender: 'male', region: 'persian', color: '#d97706', emoji: '✈️' },
  { id: 'pilot_4', label: 'Marco — Euro Jet', gender: 'male', region: 'european', color: '#6366f1', emoji: '✈️' },
  { id: 'pilot_5', label: 'Lars — Frost Pilot', gender: 'male', region: 'european', color: '#06b6d4', emoji: '✈️' },
  { id: 'pilot_6', label: 'Devon — Twilight Flyer', gender: 'male', region: 'american', color: '#a855f7', emoji: '✈️' },
  { id: 'pilot_7', label: 'Mia — Sunburst', gender: 'female', region: 'american', color: '#f472b6', emoji: '✈️' },
  { id: 'pilot_8', label: 'Yuki — Sakura Wing', gender: 'female', region: 'asian', color: '#ec4899', emoji: '✈️' },
  { id: 'pilot_9', label: 'Shirin — Golden Horizon', gender: 'female', region: 'persian', color: '#eab308', emoji: '✈️' },
  { id: 'pilot_10', label: 'Emma — Meadow Ace', gender: 'female', region: 'european', color: '#22c55e', emoji: '✈️' },
];

export const GENDERS = ['male', 'female', 'other', 'prefer_not_say'];

export const COUNTRIES = [
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'IR', name: 'Iran', flag: '🇮🇷' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
  { code: 'CN', name: 'China', flag: '🇨🇳' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸' },
  { code: 'TR', name: 'Turkey', flag: '🇹🇷' },
  { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
  { code: 'AE', name: 'UAE', flag: '🇦🇪' },
  { code: 'RU', name: 'Russia', flag: '🇷🇺' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
];
