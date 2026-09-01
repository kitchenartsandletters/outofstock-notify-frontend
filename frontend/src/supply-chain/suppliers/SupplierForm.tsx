// SupplierForm.tsx
// Modal form for creating and editing supplier parties.
// Handles: party identity + roles, primary account, primary contact.
// Mode: 'create' (new party) | 'edit' (existing party — pre-filled).
//
// Structure:
//   Three collapsible sections rendered in a single scrollable modal:
//   1. Party — name, legal name, roles, parent, country, website, terms
//   2. Account — label, account #, ordering method, email/url, freight
//   3. Contact — name, title, role, email, phone
//
// On save (create mode):
//   POST /api/suppliers → party
//   POST /api/suppliers/{id}/accounts → account (if any account fields filled)
//   POST /api/suppliers/{id}/contacts → contact (if name filled)
//   PATCH /api/suppliers/{id} → { is_active: true } if Activate toggled on
//
// On save (edit mode):
//   PATCH /api/suppliers/{id} → party fields
//   If primary account exists: PATCH /api/suppliers/accounts/{id}
//   If no account yet: POST /api/suppliers/{id}/accounts (if filled)
//   If primary contact exists: PATCH /api/suppliers/contacts/{id}
//   If no contact yet: POST /api/suppliers/{id}/contacts (if name filled)

import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  SupplierParty, SupplierAccount, SupplierContact,
  SupplierRole, OrderingMethod, ContactRole,
  SUPPLIER_ROLE_LABELS, ORDERING_METHOD_LABELS, CONTACT_ROLE_LABELS,
} from './supplierTypes'
import {
  createSupplier, updateSupplier,
  createSupplierAccount, updateSupplierAccount,
  createSupplierContact, updateSupplierContact,
  fetchSuppliers,
} from '../../api/supplyChainApi'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  mode: 'create' | 'edit'
  party?: SupplierParty
  primaryAccount?: SupplierAccount
  primaryContact?: SupplierContact
  onClose: () => void
  onSaved: (partyId: string) => void
}

interface PartyFields {
  name: string
  legal_name: string
  parent_id: string
  roles: SupplierRole[]
  country: string
  website: string
  notes: string
  payment_terms: string
  is_returnable: '' | 'true' | 'false'
  discount_pct: string
  is_active: boolean
}

interface AccountFields {
  label: string
  account_number: string
  ordering_method: OrderingMethod | ''
  ordering_email: string
  ordering_url: string
  ship_from_address: string
  freight_terms: string
  currency: string
  min_order_amount: string
  notes: string
}

interface ContactFields {
  name: string
  title: string
  role: ContactRole | ''
  email: string
  phone: string
  notes: string
}

// ---------------------------------------------------------------------------
// Small reusable field primitives
// ---------------------------------------------------------------------------

const Label = ({ children, required }: { children: React.ReactNode; required?: boolean }) => (
  <label className="block text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-bold mb-1">
    {children}{required && <span className="text-red-500 ml-0.5">*</span>}
  </label>
)

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={`w-full px-3 py-2 border rounded text-sm bg-white dark:bg-gray-800 dark:text-white dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50 ${props.className ?? ''}`}
  />
)

const Select = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    {...props}
    className={`w-full px-3 py-2 border rounded text-sm bg-white dark:bg-gray-800 dark:text-white dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50 ${props.className ?? ''}`}
  />
)

const Textarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    {...props}
    rows={2}
    className={`w-full px-3 py-2 border rounded text-sm bg-white dark:bg-gray-800 dark:text-white dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50 resize-none ${props.className ?? ''}`}
  />
)

function SectionToggle({
  label, open, onToggle, accent,
}: { label: string; open: boolean; onToggle: () => void; accent: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full flex items-center justify-between px-4 py-3 rounded-md border text-sm font-semibold transition-colors
        ${open
          ? `border-${accent}-300 dark:border-${accent}-800 bg-${accent}-50 dark:bg-${accent}-900/20 text-${accent}-800 dark:text-${accent}-200`
          : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
        }`}
    >
      <span>{label}</span>
      <span className="text-xs opacity-60">{open ? '▲' : '▼'}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Role picker — multi-select pill buttons
// ---------------------------------------------------------------------------

const ALL_ROLES: SupplierRole[] = [
  'distributor', 'wholesaler', 'publisher', 'small_press',
  'direct', 'author', 'restaurant', 'other',
]

function RolePicker({
  selected, onChange,
}: { selected: SupplierRole[]; onChange: (roles: SupplierRole[]) => void }) {
  const toggle = (role: SupplierRole) => {
    onChange(
      selected.includes(role)
        ? selected.filter(r => r !== role)
        : [...selected, role]
    )
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_ROLES.map(role => (
        <button
          key={role}
          type="button"
          onClick={() => toggle(role)}
          className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors
            ${selected.includes(role)
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400'
            }`}
        >
          {SUPPLIER_ROLE_LABELS[role]}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main form
// ---------------------------------------------------------------------------

const SupplierForm: React.FC<Props> = ({
  mode, party, primaryAccount, primaryContact, onClose, onSaved,
}) => {
  const [isVisible, setIsVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openSection, setOpenSection] = useState<'party' | 'account' | 'contact'>('party')
  const contentRef = useRef<HTMLDivElement>(null)

  // Parent search for imprint linking
  const [parentSearch, setParentSearch] = useState('')
  const [parentOptions, setParentOptions] = useState<{ id: string; name: string }[]>([])
  const [parentSearchOpen, setParentSearchOpen] = useState(false)

  // ---------------------------------------------------------------------------
  // Field state — initialised from props in edit mode
  // ---------------------------------------------------------------------------

  const [partyFields, setPartyFields] = useState<PartyFields>({
    name:          party?.name          ?? '',
    legal_name:    party?.legal_name    ?? '',
    parent_id:     party?.parent_id     ?? '',
    roles:         party?.roles         ?? [],
    country:       party?.country       ?? '',
    website:       party?.website       ?? '',
    notes:         party?.notes         ?? '',
    payment_terms: party?.payment_terms ?? '',
    is_returnable: party?.is_returnable == null ? '' : party.is_returnable ? 'true' : 'false',
    discount_pct:  party?.discount_pct  != null ? String(party.discount_pct) : '',
    is_active:     party?.is_active     ?? false,
  })

  const [accountFields, setAccountFields] = useState<AccountFields>({
    label:             primaryAccount?.label             ?? '',
    account_number:    primaryAccount?.account_number    ?? '',
    ordering_method:   primaryAccount?.ordering_method   ?? '',
    ordering_email:    primaryAccount?.ordering_email    ?? '',
    ordering_url:      primaryAccount?.ordering_url      ?? '',
    ship_from_address: primaryAccount?.ship_from_address ?? '',
    freight_terms:     primaryAccount?.freight_terms     ?? '',
    currency:          primaryAccount?.currency          ?? 'USD',
    min_order_amount:  primaryAccount?.min_order_amount  != null ? String(primaryAccount.min_order_amount) : '',
    notes:             primaryAccount?.notes             ?? '',
  })

  const [contactFields, setContactFields] = useState<ContactFields>({
    name:  primaryContact?.name  ?? '',
    title: primaryContact?.title ?? '',
    role:  primaryContact?.role  ?? '',
    email: primaryContact?.email ?? '',
    phone: primaryContact?.phone ?? '',
    notes: primaryContact?.notes ?? '',
  })

  // Slide in on mount
  useEffect(() => {
    setTimeout(() => setIsVisible(true), 10)
  }, [])

  // Parent search
  useEffect(() => {
    if (parentSearch.length < 2) { setParentOptions([]); return }
    fetchSuppliers({ search: parentSearch, activeOnly: false })
      .then(results =>
        setParentOptions(
          results
            .filter(p => p.id !== party?.id)  // exclude self in edit mode
            .slice(0, 8)
            .map(p => ({ id: p.id, name: p.name }))
        )
      )
      .catch(() => {})
  }, [parentSearch])

  const handleClose = () => {
    setIsVisible(false)
    setTimeout(onClose, 300)
  }

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const handleSave = async () => {
    if (!partyFields.name.trim()) {
      setError('Supplier name is required.')
      return
    }

    setBusy(true)
    setError(null)

    try {
      const partyPayload = {
        name:          partyFields.name.trim(),
        legal_name:    partyFields.legal_name.trim()    || undefined,
        parent_id:     partyFields.parent_id            || undefined,
        roles:         partyFields.roles,
        country:       partyFields.country.trim()       || undefined,
        website:       partyFields.website.trim()       || undefined,
        notes:         partyFields.notes.trim()         || undefined,
        payment_terms: partyFields.payment_terms.trim() || undefined,
        is_returnable: partyFields.is_returnable === ''
                         ? undefined
                         : partyFields.is_returnable === 'true',
        discount_pct:  partyFields.discount_pct !== ''
                         ? parseFloat(partyFields.discount_pct)
                         : undefined,
      }

      let partyId: string

      if (mode === 'create') {
        const created = await createSupplier(partyPayload)
        partyId = created.id

        // Activate immediately if toggled on
        if (partyFields.is_active) {
          await updateSupplier(partyId, { is_active: true })
        }
      } else {
        partyId = party!.id
        await updateSupplier(partyId, {
          ...partyPayload,
          is_active: partyFields.is_active,
        })
      }

      // Account — save if any meaningful field is filled
      const accountHasContent = accountFields.label.trim() ||
        accountFields.account_number.trim() ||
        accountFields.ordering_email.trim()

      if (accountHasContent) {
        const accountPayload = {
          label:             accountFields.label.trim() || partyFields.name.trim(),
          account_number:    accountFields.account_number.trim()    || undefined,
          ordering_method:   (accountFields.ordering_method || undefined) as OrderingMethod | undefined,
          ordering_email:    accountFields.ordering_email.trim()    || undefined,
          ordering_url:      accountFields.ordering_url.trim()      || undefined,
          ship_from_address: accountFields.ship_from_address.trim() || undefined,
          freight_terms:     accountFields.freight_terms.trim()     || undefined,
          currency:          accountFields.currency || 'USD',
          min_order_amount:  accountFields.min_order_amount !== ''
                               ? parseFloat(accountFields.min_order_amount)
                               : undefined,
          notes:             accountFields.notes.trim()             || undefined,
          is_primary:        true,
        }

        if (mode === 'edit' && primaryAccount) {
          await updateSupplierAccount(primaryAccount.id, accountPayload)
        } else {
          await createSupplierAccount(partyId, accountPayload)
        }
      }

      // Contact — save if name is filled
      if (contactFields.name.trim()) {
        const contactPayload = {
          name:  contactFields.name.trim(),
          title: contactFields.title.trim() || undefined,
          role:  (contactFields.role || undefined) as ContactRole | undefined,
          email: contactFields.email.trim() || undefined,
          phone: contactFields.phone.trim() || undefined,
          notes: contactFields.notes.trim() || undefined,
          is_primary: true,
        }

        if (mode === 'edit' && primaryContact) {
          await updateSupplierContact(primaryContact.id, contactPayload)
        } else {
          await createSupplierContact(partyId, contactPayload)
        }
      }

      onSaved(partyId)
      handleClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const p = partyFields
  const a = accountFields
  const c = contactFields
  const setP = (patch: Partial<PartyFields>) => setPartyFields(prev => ({ ...prev, ...patch }))
  const setA = (patch: Partial<AccountFields>) => setAccountFields(prev => ({ ...prev, ...patch }))
  const setC = (patch: Partial<ContactFields>) => setContactFields(prev => ({ ...prev, ...patch }))

  const title = mode === 'create' ? 'New supplier' : `Edit — ${party?.name}`

  // ---------------------------------------------------------------------------
  // Render
  //
  // Portaled to document.body, same as SupplierDetailSidebar. Stacking contract
  // for this surface: sidebar backdrop z-40 / panel z-50, this modal's backdrop
  // z-[60] / panel z-[70]. Keep the modal strictly above the sidebar — at equal
  // z the portaled sidebar wins on DOM order and clips the Save button.
  // ---------------------------------------------------------------------------

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleClose}
      />

      {/* Modal panel */}
      <div
        className={`fixed inset-0 z-[70] flex items-start justify-center pt-8 px-4 pb-8 transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
      >
        <div className="w-full max-w-xl bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 shadow-2xl flex flex-col max-h-[90vh]">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-800 shrink-0">
            <h2 className="font-bold text-gray-900 dark:text-white text-lg">{title}</h2>
            <button
              onClick={handleClose}
              className="text-sm text-gray-500 dark:text-gray-400 hover:underline"
            >
              Cancel
            </button>
          </div>

          {/* Scrollable content */}
          <div ref={contentRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

            {/* ── SECTION 1: Party ── */}
            <SectionToggle
              label="Supplier identity"
              open={openSection === 'party'}
              onToggle={() => setOpenSection(s => s === 'party' ? 'account' : 'party')}
              accent="blue"
            />

            {openSection === 'party' && (
              <div className="space-y-4 px-1">

                {/* Name */}
                <div>
                  <Label required>Name</Label>
                  <Input
                    value={p.name}
                    onChange={e => setP({ name: e.target.value })}
                    placeholder="Hachette Book Group"
                    autoFocus
                  />
                </div>

                {/* Legal name */}
                <div>
                  <Label>Legal name</Label>
                  <Input
                    value={p.legal_name}
                    onChange={e => setP({ legal_name: e.target.value })}
                    placeholder="Hachette Book Group, Inc."
                  />
                </div>

                {/* Roles */}
                <div>
                  <Label>Roles</Label>
                  <RolePicker
                    selected={p.roles}
                    onChange={roles => setP({ roles })}
                  />
                  {p.roles.length === 0 && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                      No roles assigned — this supplier will remain a draft until at least one role is set.
                    </p>
                  )}
                </div>

                {/* Parent (imprint linking) */}
                <div className="relative">
                  <Label>Parent publisher / group</Label>
                  <Input
                    value={p.parent_id
                      ? (parentOptions.find(o => o.id === p.parent_id)?.name ?? 'Selected')
                      : parentSearch}
                    onChange={e => {
                      setParentSearch(e.target.value)
                      setP({ parent_id: '' })
                      setParentSearchOpen(true)
                    }}
                    onFocus={() => setParentSearchOpen(true)}
                    placeholder="Search for parent (e.g. Penguin Random House)…"
                  />
                  {p.parent_id && (
                    <button
                      type="button"
                      onClick={() => { setP({ parent_id: '' }); setParentSearch('') }}
                      className="absolute right-2 top-7 text-xs text-gray-400 hover:text-red-500"
                    >
                      ✕
                    </button>
                  )}
                  {parentSearchOpen && parentOptions.length > 0 && !p.parent_id && (
                    <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-md shadow-lg overflow-hidden">
                      {parentOptions.map(opt => (
                        <button
                          key={opt.id}
                          type="button"
                          onMouseDown={() => {
                            setP({ parent_id: opt.id })
                            setParentSearch(opt.name)
                            setParentSearchOpen(false)
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-900 dark:text-gray-100"
                        >
                          {opt.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Country + Website */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Country</Label>
                    <Input
                      value={p.country}
                      onChange={e => setP({ country: e.target.value })}
                      placeholder="US"
                    />
                  </div>
                  <div>
                    <Label>Website</Label>
                    <Input
                      value={p.website}
                      onChange={e => setP({ website: e.target.value })}
                      placeholder="https://…"
                    />
                  </div>
                </div>

                {/* Payment terms + Returns */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Payment terms</Label>
                    <Input
                      value={p.payment_terms}
                      onChange={e => setP({ payment_terms: e.target.value })}
                      placeholder="Net 30"
                    />
                  </div>
                  <div>
                    <Label>Returns policy</Label>
                    <Select
                      value={p.is_returnable}
                      onChange={e => setP({ is_returnable: e.target.value as PartyFields['is_returnable'] })}
                    >
                      <option value="">Unknown</option>
                      <option value="true">Returnable</option>
                      <option value="false">Non-returnable</option>
                    </Select>
                  </div>
                </div>

                {/* Discount */}
                <div>
                  <Label>Default discount off list (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={p.discount_pct}
                    onChange={e => setP({ discount_pct: e.target.value })}
                    placeholder="40"
                  />
                </div>

                {/* Notes */}
                <div>
                  <Label>Notes</Label>
                  <Textarea
                    value={p.notes}
                    onChange={e => setP({ notes: e.target.value })}
                    placeholder="Internal notes about this supplier…"
                  />
                </div>

                {/* Active toggle */}
                <div className="flex items-center justify-between rounded-md border dark:border-gray-700 px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50">
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {p.is_active ? 'Active' : 'Draft (inactive)'}
                    </p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500">
                      {p.is_active
                        ? 'Visible in PO builder and supplier picker.'
                        : 'Hidden from PO builder until activated.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setP({ is_active: !p.is_active })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
                      ${p.is_active ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
                        ${p.is_active ? 'translate-x-6' : 'translate-x-1'}`}
                    />
                  </button>
                </div>
              </div>
            )}

            {/* ── SECTION 2: Account ── */}
            <SectionToggle
              label="Primary ordering account"
              open={openSection === 'account'}
              onToggle={() => setOpenSection(s => s === 'account' ? 'party' : 'account')}
              accent="purple"
            />

            {openSection === 'account' && (
              <div className="space-y-4 px-1">
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  The account is where purchase orders are sent. At least a label is recommended.
                </p>

                <div>
                  <Label>Account label</Label>
                  <Input
                    value={a.label}
                    onChange={e => setA({ label: e.target.value })}
                    placeholder="Hachette — main account"
                  />
                </div>

                <div>
                  <Label>Account number</Label>
                  <Input
                    value={a.account_number}
                    onChange={e => setA({ account_number: e.target.value })}
                    placeholder="15140987"
                  />
                </div>

                <div>
                  <Label>Ordering method</Label>
                  <Select
                    value={a.ordering_method}
                    onChange={e => setA({ ordering_method: e.target.value as OrderingMethod | '' })}
                  >
                    <option value="">— select —</option>
                    {(Object.entries(ORDERING_METHOD_LABELS) as [OrderingMethod, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </Select>
                </div>

                {(a.ordering_method === 'email' || a.ordering_method === '') && (
                  <div>
                    <Label>Ordering email</Label>
                    <Input
                      type="email"
                      value={a.ordering_email}
                      onChange={e => setA({ ordering_email: e.target.value })}
                      placeholder="orders@hachette.com"
                    />
                  </div>
                )}

                {a.ordering_method === 'web_portal' && (
                  <div>
                    <Label>Portal URL</Label>
                    <Input
                      value={a.ordering_url}
                      onChange={e => setA({ ordering_url: e.target.value })}
                      placeholder="https://orders.hachette.com"
                    />
                  </div>
                )}

                <div>
                  <Label>Ship-from address</Label>
                  <Input
                    value={a.ship_from_address}
                    onChange={e => setA({ ship_from_address: e.target.value })}
                    placeholder="322 South Enterprise Blvd, Lebanon IN 46052"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Freight terms</Label>
                    <Input
                      value={a.freight_terms}
                      onChange={e => setA({ freight_terms: e.target.value })}
                      placeholder="FOB destination"
                    />
                  </div>
                  <div>
                    <Label>Min order ($)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={a.min_order_amount}
                      onChange={e => setA({ min_order_amount: e.target.value })}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div>
                  <Label>Account notes</Label>
                  <Textarea
                    value={a.notes}
                    onChange={e => setA({ notes: e.target.value })}
                    placeholder="EDI setup details, special ordering instructions…"
                  />
                </div>
              </div>
            )}

            {/* ── SECTION 3: Contact ── */}
            <SectionToggle
              label="Primary contact"
              open={openSection === 'contact'}
              onToggle={() => setOpenSection(s => s === 'contact' ? 'party' : 'contact')}
              accent="green"
            />

            {openSection === 'contact' && (
              <div className="space-y-4 px-1">
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Optional. You can add additional contacts from the supplier detail view.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Full name</Label>
                    <Input
                      value={c.name}
                      onChange={e => setC({ name: e.target.value })}
                      placeholder="Jane Smith"
                    />
                  </div>
                  <div>
                    <Label>Title</Label>
                    <Input
                      value={c.title}
                      onChange={e => setC({ title: e.target.value })}
                      placeholder="Sales Rep"
                    />
                  </div>
                </div>

                <div>
                  <Label>Role</Label>
                  <Select
                    value={c.role}
                    onChange={e => setC({ role: e.target.value as ContactRole | '' })}
                  >
                    <option value="">— select —</option>
                    {(Object.entries(CONTACT_ROLE_LABELS) as [ContactRole, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={c.email}
                      onChange={e => setC({ email: e.target.value })}
                      placeholder="jane@publisher.com"
                    />
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <Input
                      value={c.phone}
                      onChange={e => setC({ phone: e.target.value })}
                      placeholder="212-555-0100"
                    />
                  </div>
                </div>

                <div>
                  <Label>Notes</Label>
                  <Textarea
                    value={c.notes}
                    onChange={e => setC({ notes: e.target.value })}
                    placeholder="Best time to reach, preferred method…"
                  />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="px-3 py-2.5 rounded-md bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t dark:border-gray-800 flex items-center justify-between shrink-0 bg-gray-50/50 dark:bg-gray-900/30">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {mode === 'create'
                ? 'All sections optional except name.'
                : `Editing ${party?.name}`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={busy}
                className="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={busy || !p.name.trim()}
                className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors active:scale-[0.98]"
              >
                {busy ? 'Saving…' : mode === 'create' ? 'Create supplier' : 'Save changes'}
              </button>
            </div>
          </div>

        </div>
      </div>
    </>,
    document.body
  )
}

export default SupplierForm
