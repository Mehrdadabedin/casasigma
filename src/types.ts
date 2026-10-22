export type PropertyKind = 'Apartment' | 'House' | 'Loft' | 'Villa';

export type RestaurantTenure = 'Freehold' | 'Lease' | 'Traspaso';

export interface Agent {
  name: string;
  phone: string;
  email?: string;
}

export interface House {
  id: string;
  title: string;
  kind: PropertyKind;
  city: string;
  neighborhood: string;
  address: string;
  price: number;
  beds: number;
  baths: number;
  area: number;
  rating: number;
  reviewCount: number;
  description: string;
  amenities: string[];
  gradient: [string, string];
  agent: Agent;
  openHouse: string;
}

export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  city: string;
  neighborhood: string;
  address: string;
  /** Asking price in euros: freehold, lease premium or traspaso. */
  price: number;
  seats: number;
  tenure: RestaurantTenure;
  hours: string;
  rating: number;
  reviewCount: number;
  blurb: string;
  description: string;
  features: string[];
  gradient: [string, string];
  agent: Agent;
}

export type BookingStatus = 'Requested' | 'Confirmed' | 'Cancelled';

export interface Booking {
  kind: 'visit';
  id: string;
  houseId: string;
  date: string;
  time: string;
  name: string;
  note: string;
  visitors: number;
  status: BookingStatus;
  createdAt: string;
}

export interface StoreShape {
  version: 1;
  bookings: Booking[];
}
