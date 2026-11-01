// MKT3.3: the Sell form adds photos one at a time. A new form has one add box;
// each photo brings a new box; at the limit the box goes away.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../src/state/LanguageProvider';
import { Sell } from '../../src/pages/Sell';
import { ApiError, type Listing } from '../../src/lib/api';

const auth = vi.hoisted(() => ({ user: { id: 's1', canSell: true }, ready: true }));
vi.mock('../../src/state/AuthProvider', () => ({ useAuth: () => auth }));

const api = vi.hoisted(() => ({
  mine: vi.fn(),
  create: vi.fn(),
  uploadPhoto: vi.fn(),
  cities: vi.fn(),
}));
vi.mock('../../src/lib/api', async (original) => {
  const actual = await original<typeof import('../../src/lib/api')>();
  return {
    ...actual,
    cityApi: { list: api.cities },
    listingApi: { ...actual.listingApi, mine: api.mine, create: api.create, uploadPhoto: api.uploadPhoto },
  };
});
vi.mock('../../src/lib/image', async (original) => ({
  ...(await original<typeof import('../../src/lib/image')>()),
  shrinkImage: async (file: File) => file,
}));

const listing: Listing = {
  id: 'l1',
  title: 'Villa with a view',
  kind: 'Villa',
  city: 'Mijas',
  price: 450000,
  description: '',
  photos: [],
  createdAt: '2026-10-24T10:00:00Z',
};

const photo = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

/** Pick a file in the add box, which is the only box that is not filled. */
function pick(container: HTMLElement, name: string) {
  const input = container.querySelector('.photoslot:not(.is-filled) input[type=file]')!;
  fireEvent.change(input, { target: { files: [photo(name)] } });
}

const slots = (container: HTMLElement) =>
  [...container.querySelectorAll('.photoslot.is-filled img')].map((img) => img.getAttribute('alt'));

async function openNewForm(usage = { used: 0, max: 20 }) {
  api.mine.mockResolvedValue({ listings: [], photoUsage: usage });
  const view = render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/sell']}>
        <Sell />
      </MemoryRouter>
    </LanguageProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Add listing' }));
  return view.container;
}

beforeEach(() => {
  api.cities.mockResolvedValue([]);
  let count = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => `blob:${(count += 1)}`, revokeObjectURL: () => undefined }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('add photos one at a time', () => {
  it('a new form shows one add box and no others', async () => {
    const container = await openNewForm();
    expect(container.querySelectorAll('.photoslot')).toHaveLength(1);
    expect(container.querySelectorAll('.photoslot__add')).toHaveLength(1);
  });

  it('a chosen photo is shown and brings one new add box with the next slot', async () => {
    const container = await openNewForm();
    pick(container, 'a.jpg');
    expect(container.querySelectorAll('.photoslot.is-filled')).toHaveLength(1);
    expect(container.querySelectorAll('.photoslot__add')).toHaveLength(1);
    expect(container.querySelector('.photoslot:not(.is-filled)')?.getAttribute('data-slot')).toBe('2');
    pick(container, 'b.jpg');
    expect(container.querySelector('.photoslot:not(.is-filled)')?.getAttribute('data-slot')).toBe('3');
  });

  it('removing the cover and adding a photo does not make the new photo the cover', async () => {
    const container = await openNewForm();
    pick(container, 'a.jpg');
    pick(container, 'b.jpg');
    fireEvent.click(container.querySelectorAll('.photoslot__remove')[0]);
    expect(slots(container)).toEqual(['Photo 2']);
    pick(container, 'c.jpg');
    expect(slots(container)).toEqual(['Photo 2', 'Photo 3']);
  });

  it('with 20 used there is no add box and the message shows', async () => {
    const container = await openNewForm({ used: 20, max: 20 });
    expect(container.querySelector('.photoslot__add')).toBeNull();
    expect(container.textContent).toContain('limit of 20 photos');
  });

  it('drafts count too: the add box goes away when used and drafts reach 20', async () => {
    const container = await openNewForm({ used: 19, max: 20 });
    expect(container.querySelectorAll('.photoslot__add')).toHaveLength(1);
    pick(container, 'a.jpg');
    expect(container.querySelector('.photoslot__add')).toBeNull();
    expect(container.textContent).toContain('limit of 20 photos');
  });

  it('publishing uploads every draft in slot order', async () => {
    api.create.mockResolvedValue(listing);
    api.uploadPhoto.mockImplementation(async (_id: string, slot: number) => ({
      listing,
      photoUsage: { used: slot, max: 20 },
    }));
    const container = await openNewForm();
    pick(container, 'a.jpg');
    pick(container, 'b.jpg');
    pick(container, 'c.jpg');
    fireEvent.click(container.querySelectorAll('.photoslot__remove')[0]);
    const title = screen.getByPlaceholderText('e.g. Cortijo with two guest houses');
    fireEvent.change(title, { target: { value: 'Villa with a view' } });
    fireEvent.change(screen.getByPlaceholderText('350000'), { target: { value: '450000' } });
    fireEvent.change(container.querySelector('input[list=sell-cities]')!, { target: { value: 'Mijas' } });
    fireEvent.submit(title.closest('form')!);
    await waitFor(() => expect(api.uploadPhoto).toHaveBeenCalledTimes(2));
    expect(api.uploadPhoto.mock.calls.map((call) => call[1])).toEqual([2, 3]);
  });

  it('a 409 while publishing keeps the listing in edit mode with the limit message', async () => {
    api.create.mockResolvedValue(listing);
    api.uploadPhoto.mockRejectedValue(new ApiError('You can have at most 20 photos.', 409, 'photos'));
    const container = await openNewForm();
    pick(container, 'a.jpg');
    const title = screen.getByPlaceholderText('e.g. Cortijo with two guest houses');
    fireEvent.change(title, { target: { value: 'Villa with a view' } });
    fireEvent.change(screen.getByPlaceholderText('350000'), { target: { value: '450000' } });
    fireEvent.change(container.querySelector('input[list=sell-cities]')!, { target: { value: 'Mijas' } });
    fireEvent.submit(title.closest('form')!);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('limit of 20 photos');
    expect(screen.getByRole('form', { name: 'Edit listing' })).toBeTruthy();
    expect(api.create).toHaveBeenCalledTimes(1);
  });
});
