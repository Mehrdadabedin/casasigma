export type Role = 'buyer' | 'seller' | 'admin';

/** Photo slots per listing; slot 1 is the cover. */
export const PHOTO_SLOTS = 5;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  /** The admin signs in as `admin`; ordinary accounts sign in with their email. */
  username: string | null;
  /** What the account may do, derived from the role it signed up with. */
  canBuy: boolean;
  canSell: boolean;
  /** Suspended accounts cannot sign in and are blocked from every API call. */
  suspended: boolean;
  /** True while the admin still uses the public starter password. */
  mustSetPassword: boolean;
  createdAt: string;
}

export class ApiError extends Error {
  status: number;
  field?: string;

  constructor(message: string, status: number, field?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = field;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as
    | { error?: string; field?: string }
    | null;

  if (!response.ok) {
    throw new ApiError(payload?.error ?? 'Something went wrong. Try again.', response.status, payload?.field);
  }

  return payload as T;
}

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  role: Role;
}

export const authApi = {
  me: () => request<{ user: SessionUser }>('/api/auth/me').then((data) => data.user),
  /** `identifier` is an email address or the admin username. */
  login: (identifier: string, password: string) =>
    request<{ user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: identifier, password }),
    }).then((data) => data.user),
  /** Replace the starter admin credentials with the admin's own. */
  updateAdminCredentials: (input: { currentPassword: string; username: string; password: string }) =>
    request<{ user: SessionUser }>('/api/auth/admin-credentials', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((data) => data.user),
  signup: (input: SignupInput) =>
    request<{ user: SessionUser }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((data) => data.user),
  /** Always answers 202, so the form cannot reveal which emails have accounts. */
  forgotPassword: (email: string) =>
    request<{ ok: true }>('/api/auth/forgot', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  /** Redeem the token mailed by `forgotPassword`; signs every device out. */
  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>('/api/auth/reset', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
};

export interface City {
  id: string;
  name: string;
  listings: number;
}

export interface ListingPhotoRef {
  /** Fixed slot 1–5; removing one leaves the others in their slots. */
  slot: number;
  /** Media slug served at `api/media/:slug`. */
  slug: string;
}

export interface Listing {
  id: string;
  title: string;
  kind: string;
  city: string;
  /** Absent for a signed-out visitor (MKT1.3); `locked` is then true. */
  price?: number;
  description?: string;
  sellerName?: string | null;
  locked?: boolean;
  /** Ordered by slot; the first slot present is the cover. Empty for a guest. */
  photos: ListingPhotoRef[];
  createdAt: string;
}

export interface ListingInput {
  title: string;
  kind: string;
  city: string;
  price: number;
  description: string;
}

export type ViewingStatus = 'Requested' | 'Confirmed' | 'Cancelled';

export interface ViewingRequest {
  id: string;
  listingId: string;
  listingTitle: string;
  name: string;
  email: string;
  description: string;
  /** Local ISO date, YYYY-MM-DD. */
  date: string;
  time: string;
  status: ViewingStatus;
  createdAt: string;
}

export interface ViewingInput {
  listingId: string;
  listingTitle: string;
  name: string;
  email: string;
  description: string;
  date: string;
  time: string;
  /** Honeypot: people never see this field; the server drops a filled one. */
  website?: string;
}

export type PhotoStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface Profile {
  id: string;
  kind: 'buyer' | 'seller';
  displayName: string;
  phone: string | null;
  company: string | null;
  lookingFor: string | null;
  bio: string | null;
  /** Only set once the admin has approved the portrait. */
  photoSlug: string | null;
  photoStatus: PhotoStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
}

export interface ProfileInput {
  displayName: string;
  phone: string;
  company: string;
  lookingFor: string;
  bio: string;
}

export interface PublicProfile {
  kind: 'buyer' | 'seller';
  displayName: string;
  company: string | null;
  bio: string | null;
  photoSlug: string;
}

export interface PhotoQueueItem extends Profile {
  accountEmail: string;
  accountRole: Role;
  /** Present even while pending, so the queue can show what it is approving. */
  photoSlug: string;
}

export const cityApi = {
  list: () => request<{ cities: City[] }>('/api/cities').then((data) => data.cities),
};

export const listingApi = {
  list: () => request<{ listings: Listing[] }>('/api/listings').then((data) => data.listings),
  mine: () =>
    request<{ listings: Listing[] }>('/api/listings?mine=1').then((data) => data.listings),
  create: (input: ListingInput) =>
    request<{ listing: Listing }>('/api/listings', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((data) => data.listing),
  get: (id: string) =>
    request<{ listing: Listing }>(`/api/listings/${encodeURIComponent(id)}`).then(
      (data) => data.listing,
    ),
  update: (id: string, input: ListingInput) =>
    request<{ listing: Listing }>(`/api/listings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }).then((data) => data.listing),
  remove: (id: string) =>
    request<{ ok: true }>(`/api/listings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Store a photo in slot 1–5; replacing a slot deletes the previous file. */
  uploadPhoto: async (id: string, slot: number, blob: Blob): Promise<Listing> => {
    const response = await fetch(
      `/api/listings/${encodeURIComponent(id)}/photos?slot=${slot}`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': blob.type || 'image/jpeg' },
        body: blob,
      },
    );
    const payload = (await response.json().catch(() => null)) as
      | { listing?: Listing; error?: string; field?: string }
      | null;
    if (!response.ok || !payload?.listing) {
      throw new ApiError(payload?.error ?? 'Upload failed.', response.status, payload?.field);
    }
    return payload.listing;
  },
  removePhoto: (id: string, slot: number) =>
    request<{ listing: Listing }>(
      `/api/listings/${encodeURIComponent(id)}/photos/${slot}`,
      { method: 'DELETE' },
    ).then((data) => data.listing),
};

export const viewingApi = {
  list: () =>
    request<{ requests: ViewingRequest[] }>('/api/viewings').then((data) => data.requests),
  create: (input: ViewingInput) =>
    request<{ request: ViewingRequest }>('/api/viewings', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((data) => data.request),
  cancel: (id: string) =>
    request<{ request: ViewingRequest }>(`/api/viewings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'Cancelled' }),
    }).then((data) => data.request),
};

export const sellerViewingApi = {
  list: () =>
    request<{ requests: ViewingRequest[] }>('/api/seller/viewings').then((data) => data.requests),
  answer: (id: string, status: 'Confirmed' | 'Cancelled') =>
    request<{ request: ViewingRequest }>(`/api/seller/viewings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }).then((data) => data.request),
};

export const profileApi = {
  me: () =>
    request<{ profile: Profile | null }>('/api/profile').then((data) => data.profile),
  save: (input: ProfileInput) =>
    request<{ profile: Profile }>('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(input),
    }).then((data) => data.profile),
  /** Store a portrait file; it enters the admin approval queue. */
  uploadPhoto: async (blob: Blob): Promise<Profile> => {
    const response = await fetch('/api/profile/photo', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': blob.type || 'image/jpeg' },
      body: blob,
    });
    const payload = (await response.json().catch(() => null)) as
      | { profile?: Profile; error?: string; field?: string }
      | null;
    if (!response.ok || !payload?.profile) {
      throw new ApiError(payload?.error ?? 'Upload failed.', response.status, payload?.field);
    }
    return payload.profile;
  },
  public: () =>
    request<{ profiles: PublicProfile[] }>('/api/profiles').then((data) => data.profiles),
};

export interface AdminStats {
  total: number;
  buyers: number;
  sellers: number;
  admins: number;
  suspended: number;
}

export const adminApi = {
  users: (query = '') =>
    request<{ users: SessionUser[]; stats: AdminStats }>(
      `/api/admin/users${query ? `?q=${encodeURIComponent(query)}` : ''}`,
    ),
  setSuspended: (id: string, suspended: boolean) =>
    request<{ user: SessionUser }>(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ suspended }),
    }).then((data) => data.user),
  remove: (id: string) =>
    request<{ deleted: string; email: string }>(
      `/api/admin/users/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),
  photos: () =>
    request<{ photos: PhotoQueueItem[] }>('/api/admin/photos').then((data) => data.photos),
  reviewPhoto: (id: string, status: 'approved' | 'rejected') =>
    request<{ photo: PhotoQueueItem }>(`/api/admin/photos/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }).then((data) => data.photo),
};
