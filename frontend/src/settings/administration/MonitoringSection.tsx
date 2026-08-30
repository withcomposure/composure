import { useCallback, useEffect, useState } from 'react'
import { Monitor, RefreshCw } from 'lucide-react'
import { SegmentedControl } from '@/components/SegmentedControl'
import { fetchJson, getErrorMessage } from '@/utils/fetch'
import { fmtTime, fmtRelativeTime } from '@/utils/format-time'

interface JobQueueSummary {
  runningCount: number
  waitingCount: number
  lastCompletedAt: number | null
  lastFailedJob: { id: string; type: string; error: string | null; finishedAt: number } | null
  totalDone: number
  totalFailed: number
  totalInvalid: number
  totalStalled: number
}

interface BackgroundJobSummary {
  id: string
  type: string
  status: 'waiting' | 'running' | 'done' | 'failed' | 'invalid' | 'stalled'
  userId: string | null
  userEmail: string | null
  userDisplayName: string | null
  projectId: string | null
  projectTitle: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  error: string | null
}

type HealthStatus = 'healthy' | 'degraded' | 'stalled'

const jobTimeframeOptions = [
  { value: '3600', label: '1h' },
  { value: '7200', label: '2h' },
  { value: '21600', label: '6h' },
  { value: '43200', label: '12h' },
  { value: '86400', label: '24h' },
] as const

interface MonitoringSectionProps {
  sectionRef: (node: HTMLElement | null) => void
}

export function MonitoringSection({ sectionRef }: MonitoringSectionProps) {
  const [jobSummary, setJobSummary] = useState<JobQueueSummary | null>(null)
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('healthy')
  const [recentJobs, setRecentJobs] = useState<BackgroundJobSummary[]>([])
  const [jobsTimeframe, setJobsTimeframe] = useState<string>('86400')
  const [monitoringBusy, setMonitoringBusy] = useState(false)
  const [monitoringError, setMonitoringError] = useState<string | null>(null)

  // setState stays inside the fetch callbacks so both the mount/timeframe
  // effect and the Refresh button can share this loader.
  const fetchMonitoringData = useCallback((seconds: string) => {
    return fetchJson<{ jobs: BackgroundJobSummary[]; health: HealthStatus }>(`/admin/monitoring/jobs?seconds=${seconds}`)
      .then(async (response) => {
        setRecentJobs(response.jobs)
        setHealthStatus(response.health)
        const summaryResponse = await fetchJson<{ summary: JobQueueSummary; health: HealthStatus }>(`/admin/monitoring/summary?seconds=${seconds}`)
        setJobSummary(summaryResponse.summary)
        setHealthStatus(summaryResponse.health)
      })
      .catch((err: unknown) => {
        setMonitoringError(getErrorMessage(err))
      })
  }, [])

  const loadMonitoringData = useCallback(async (seconds: string) => {
    setMonitoringBusy(true)
    setMonitoringError(null)
    try {
      await fetchMonitoringData(seconds)
    } finally {
      setMonitoringBusy(false)
    }
  }, [fetchMonitoringData])

  // Kept separate from the settings loaders: changing the monitoring
  // timeframe must not re-fetch the settings forms and wipe unsaved edits.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setMonitoringBusy(true)
      setMonitoringError(null)
      try {
        await fetchMonitoringData(jobsTimeframe)
      } finally {
        if (!cancelled) {
          setMonitoringBusy(false)
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [fetchMonitoringData, jobsTimeframe])

  return (
    <section id="admin-section-monitoring" ref={sectionRef} className="scroll-mt-6 rounded-xl border border-cz-border bg-cz-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Monitor size={14} /> Monitoring
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            healthStatus === 'healthy' ? 'bg-green-500/20 text-green-400' :
            healthStatus === 'degraded' ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-red-500/20 text-red-400'
          }`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${
              healthStatus === 'healthy' ? 'bg-green-400' :
              healthStatus === 'degraded' ? 'bg-yellow-400' :
              'bg-red-400'
            }`} />
            {healthStatus === 'healthy' ? 'Healthy' : healthStatus === 'degraded' ? 'Degraded' : 'Stalled'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl
            value={jobsTimeframe}
            options={jobTimeframeOptions}
            onChange={(next) => {
              setJobsTimeframe(next)
            }}
            ariaLabel="Monitoring timeframe"
          />
          <button
            type="button"
            onClick={() => { void loadMonitoringData(jobsTimeframe) }}
            disabled={monitoringBusy}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-cz-border bg-cz-bg px-3 text-xs text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text disabled:opacity-60"
          >
            <RefreshCw size={14} className={monitoringBusy ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {monitoringError && <div className="mb-3 text-sm text-red-300">{monitoringError}</div>}

      {/* Summary Cards */}
      {jobSummary && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-cz-border bg-cz-bg/50 p-3">
            <div className="text-xs text-cz-text-muted">Active / Queued</div>
            <div className="mt-1 text-lg font-semibold text-cz-text">
              {jobSummary.runningCount}{' / '}{jobSummary.waitingCount}
            </div>
          </div>
          <div className="rounded-md border border-cz-border bg-cz-bg/50 p-3">
            <div className="text-xs text-cz-text-muted">Last Completed</div>
            <div className="mt-1 text-sm text-cz-text">
              {jobSummary.lastCompletedAt ? fmtRelativeTime(jobSummary.lastCompletedAt) : 'None'}
            </div>
          </div>
          <div className="rounded-md border border-cz-border bg-cz-bg/50 p-3">
            <div className="text-xs text-cz-text-muted">Last Failed</div>
            <div className="mt-1 text-sm text-cz-text">
              {jobSummary.lastFailedJob ? (
                <span>
                  <span className="text-red-300">{jobSummary.lastFailedJob.type}</span>{' '}
                  <span className="text-cz-text-muted">{fmtRelativeTime(jobSummary.lastFailedJob.finishedAt)}</span>
                  {jobSummary.lastFailedJob.error && (
                    <div className="mt-0.5 truncate text-xs text-red-300/80">{jobSummary.lastFailedJob.error}</div>
                  )}
                </span>
              ) : 'None'}
            </div>
          </div>
          <div className="rounded-md border border-cz-border bg-cz-bg/50 p-3">
            <div className="text-xs text-cz-text-muted">Last {jobTimeframeOptions.find((o) => o.value === jobsTimeframe)?.label ?? '24h'}</div>
            <div className="mt-1 text-sm text-cz-text">
              <span className="text-green-400">{jobSummary.totalDone} done</span>
              {' / '}
              <span className="text-red-300">{jobSummary.totalFailed} failed</span>
              {jobSummary.totalInvalid > 0 && (
                <>
                  {' / '}
                  <span className="text-yellow-400">{jobSummary.totalInvalid} invalid</span>
                </>
              )}
              {jobSummary.totalStalled > 0 && (
                <>
                  {' / '}
                  <span className="text-orange-400">{jobSummary.totalStalled} stalled</span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Jobs table */}
      <div className="text-xs font-medium text-cz-text mb-2">Jobs</div>
      <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-xl border border-cz-border bg-cz-bg/40">
        <div className="inline-grid grid-cols-[minmax(80px,1fr)_minmax(80px,1fr)_minmax(70px,0.8fr)_minmax(60px,0.7fr)_minmax(90px,1fr)_minmax(90px,1fr)_minmax(90px,1fr)] gap-3 border-b border-cz-border px-3 py-2 text-xs uppercase tracking-wider text-cz-text-muted min-w-full">
          <span>User</span>
          <span>Project</span>
          <span>Type</span>
          <span>Status</span>
          <span>Created</span>
          <span>Started</span>
          <span>Finished</span>
        </div>
        {recentJobs.length === 0 ? (
          <div className="px-3 py-4 text-sm text-cz-text-muted">No jobs in this timeframe.</div>
        ) : (
          recentJobs.map((job) => (
            <div
              key={job.id}
              className="inline-grid grid-cols-[minmax(80px,1fr)_minmax(80px,1fr)_minmax(70px,0.8fr)_minmax(60px,0.7fr)_minmax(90px,1fr)_minmax(90px,1fr)_minmax(90px,1fr)] gap-3 border-b border-cz-border px-3 py-2 text-sm text-cz-text min-w-full last:border-b-0"
            >
              <span className="truncate text-xs" title={job.userEmail ?? job.userId ?? 'unknown'}>
                {job.userDisplayName ?? job.userEmail ?? (job.userId ? `User ${job.userId.slice(0, 8)}` : '—')}
              </span>
              <span className="truncate text-xs" title={job.projectId ?? undefined}>
                {job.projectTitle ?? (job.projectId ? `${job.projectId.slice(0, 8)}…` : '—')}
              </span>
              <span className="text-xs">{job.type}</span>
              <span className={`text-xs font-medium ${
                job.status === 'done' ? 'text-green-400' :
                job.status === 'failed' ? 'text-red-300' :
                job.status === 'running' ? 'text-blue-400' :
                job.status === 'invalid' ? 'text-yellow-400' :
                job.status === 'stalled' ? 'text-orange-400' :
                job.status === 'waiting' ? 'text-sky-300' :
                'text-cz-text-muted'
              }`}>
                {job.status}
                {job.status === 'failed' && job.error && (
                  <span className="block truncate font-normal text-red-300/70" title={job.error}>{job.error}</span>
                )}
                {job.status === 'invalid' && job.error && (
                  <span className="block truncate font-normal text-yellow-400/70" title={job.error}>{job.error}</span>
                )}
                {job.status === 'stalled' && job.error && (
                  <span className="block truncate font-normal text-orange-400/70" title={job.error}>{job.error}</span>
                )}
              </span>
              <span className="text-xs text-cz-text-muted">{fmtTime(job.createdAt)}</span>
              <span className="text-xs text-cz-text-muted">{job.startedAt ? fmtTime(job.startedAt) : '—'}</span>
              <span className="text-xs text-cz-text-muted">{job.finishedAt ? fmtTime(job.finishedAt) : '—'}</span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
