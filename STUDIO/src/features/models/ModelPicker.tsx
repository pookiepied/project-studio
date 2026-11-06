import { useMemo, useRef, type ReactNode } from 'react'
import { Icons } from '@/components/icons'
import { MenuItem, MenuLabel, MenuSeparator, MenuViews, SearchField } from '@/components/primitives'
import { findCatalogModel, type CatalogModel } from '@/domain/models/catalog'
import { connectionCatalog, type CatalogConnection } from '@/domain/models/connections'
import { familyName } from '@/domain/models/families'
import { loadRecentModelIds } from '@/domain/models/recents'
import { CatalogStateNote, type CatalogState } from './CatalogStateNote'
import { ProviderMark } from './ProviderMark'

type Choose = (modelId: string | null) => void

export function ModelPicker({
  catalog,
  models,
  hasConnections,
  selected,
  query,
  browsing,
  onSearch,
  onChoose,
  onBrowse,
  onSettings,
  onRetry,
  children,
}: {
  catalog: CatalogState
  models: readonly CatalogModel[]
  hasConnections: boolean
  selected: string | null
  query: string
  browsing: boolean
  onSearch: (query: string) => void
  onChoose: Choose
  onBrowse: () => void
  onSettings: () => void
  onRetry: () => void
  children: ReactNode
}) {
  const ready = catalog.phase.status === 'ready'
  const needle = query.trim().toLowerCase()
  const searching = ready && models.length > 0 && needle !== ''
  const results = useMemo(() => {
    if (!ready || needle === '') return []
    return connectionCatalog(models.filter((model) =>
      [model.name, model.modelId, familyName(model.author), model.connectionName]
        .some((value) => value.toLowerCase().includes(needle)),
    ))
  }, [models, needle, ready])

  const shortcuts = new Map<string, CatalogModel>()
  for (const id of [selected, ...loadRecentModelIds()]) {
    const model = findCatalogModel(models, id)
    if (model !== undefined) shortcuts.set(model.id, model)
    if (shortcuts.size === 3) break
  }

  return (
    <>
      <div className="px-2 pt-1">
        <SearchField
          autoFocus
          ariaLabel="Search models"
          placeholder="Search models..."
          appearance="menu"
          value={query}
          onChange={onSearch}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || results.length !== 1 || results[0]?.models.length !== 1) return
            const match = results[0].models[0]
            if (match === undefined) return
            event.preventDefault()
            onChoose(match.id)
          }}
        />
      </div>
      <MenuSeparator />
      <MenuViews view={searching ? 'results' : 'models'} depth={0} resize={false}>
        {!ready ? (
          <>
            <CatalogStateNote catalog={catalog} />
            {catalog.phase.status === 'failed' || catalog.phase.status === 'no-harness' ? (
              <MenuItem icon={<Icons.reload />} onSelect={onRetry}>Try again</MenuItem>
            ) : null}
          </>
        ) : searching ? (
          results.length === 0 ? (
            <p role="status" className="px-2 py-2 text-ui text-muted-foreground">
              No models match &quot;{query.trim()}&quot;.
            </p>
          ) : (
            <div className="studio-scroll-bounded max-h-[min(16rem,50dvh)] overflow-y-auto overscroll-contain">
              {results.map((connection) => (
                <section key={connection.id} aria-label={connection.name}>
                  <MenuLabel>{connection.name}</MenuLabel>
                  <ModelRows models={connection.models} selected={selected} onChoose={onChoose} />
                </section>
              ))}
            </div>
          )
        ) : (
          <>
            <MenuLabel>Optional</MenuLabel>
            <MenuItem selected={selected === null} onSelect={() => onChoose(null)}>Default</MenuItem>
            {models.length === 0 ? (
              <>
                <p className="px-2 py-2 text-ui text-muted-foreground">
                  {hasConnections
                    ? 'No chat models available. Offer models or add a provider in Settings.'
                    : 'No connections yet. Add a provider in Settings to choose a model.'}
                </p>
                <MenuItem icon={<Icons.settings />} onSelect={onSettings}>Open Settings</MenuItem>
              </>
            ) : (
              <>
                <MenuLabel>Models</MenuLabel>
                <MenuItem endIcon={<Icons.disclosure />} expanded={browsing} onSelect={onBrowse}>
                  More models
                </MenuItem>
                <ModelRows
                  models={shortcuts.size > 0 ? [...shortcuts.values()] : models.slice(0, 3)}
                  selected={selected}
                  onChoose={onChoose}
                  showConnection
                />
              </>
            )}
          </>
        )}
        {!searching ? (
          <>
            {children}
            <MenuSeparator />
            <button
              type="button"
              role="switch"
              aria-checked={false}
              aria-label="Temporary chat"
              aria-description="Coming soon"
              disabled
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-ui text-muted-foreground"
            >
              <Icons.temporaryChat />
              <span className="min-w-0 flex-1 truncate">Temporary chat</span>
              <span className="shrink-0 text-micro">Soon</span>
              <span aria-hidden className="flex h-4 w-7 items-center rounded-full bg-foreground/10 p-0.5">
                <span className="size-3 rounded-full bg-muted-foreground/50" />
              </span>
            </button>
          </>
        ) : null}
      </MenuViews>
    </>
  )
}

export function ModelProviders({
  models,
  connectionId,
  selected,
  onConnection,
  onChoose,
  onBack,
  onSettings,
}: {
  models: readonly CatalogModel[]
  connectionId: string | null
  selected: string | null
  onConnection: (id: string | null) => void
  onChoose: Choose
  onBack: () => void
  onSettings: () => void
}) {
  const connections = useMemo(() => connectionCatalog(models), [models])
  const connection = connections.find(({ id }) => id === connectionId)
  const back = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        type="button"
        ref={back}
        data-companion-focus
        onClick={connection === undefined ? onBack : () => onConnection(null)}
        className="studio-control-flat flex w-full items-center gap-2 rounded-md px-2 text-left text-ui text-muted-foreground hover:bg-tint hover:text-foreground"
      >
        <Icons.back />
        {connection === undefined ? 'Providers' : 'All providers'}
      </button>
      <MenuSeparator />
      <div className="studio-scroll-bounded max-h-[min(16rem,50dvh)] overflow-y-auto overscroll-contain">
        <MenuViews view={connection === undefined ? 'providers' : `connection:${connection.id}`} depth={connection === undefined ? 0 : 1}>
          {connection === undefined ? (
            connections.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                onSelect={() => {
                  onConnection(provider.id)
                  back.current?.focus()
                }}
              />
            ))
          ) : (
            <>
              <MenuLabel>{connection.name}</MenuLabel>
              <ModelRows models={connection.models} selected={selected} onChoose={onChoose} />
            </>
          )}
        </MenuViews>
      </div>
      <MenuSeparator />
      <MenuItem icon={<Icons.settings />} endIcon={<Icons.disclosure />} onSelect={onSettings}>
        Manage providers
      </MenuItem>
    </>
  )
}

function ProviderRow({ provider, onSelect }: { provider: CatalogConnection; onSelect: () => void }) {
  return (
    <MenuItem
      icon={<ProviderMark provider={provider.vendor} bare />}
      endIcon={<Icons.disclosure />}
      onSelect={onSelect}
    >
      {provider.name}
    </MenuItem>
  )
}

function ModelRows({ models, selected, onChoose, showConnection = false }: {
  models: readonly CatalogModel[]
  selected: string | null
  onChoose: Choose
  showConnection?: boolean
}) {
  return models.map((model) => (
    <MenuItem
      key={model.id}
      icon={<ProviderMark provider={model.author} bare />}
      selected={model.id === selected}
      onSelect={() => onChoose(model.id)}
      hint={showConnection && models.some((other) =>
        other.name === model.name && other.connectionId !== model.connectionId,
      ) ? model.connectionName : undefined}
    >
      {model.name}
    </MenuItem>
  ))
}
