import { useState, type ReactNode } from 'react';
import type { Audit, Finding } from '@blindspot/shared';
import { findingLocation, humanDate } from '../lib/format';
import { Icon } from './Icon';

export function FindingLocation({ audit, finding, children }: { audit: Audit; finding: Finding; children?: ReactNode }) {
  const location = findingLocation(audit, finding);
  const [imageFailed, setImageFailed] = useState(false);
  return <section className="finding-location" aria-label="Issue location">
    <h3>Where this happens</h3>
    {location.pageUrl ? <a className="finding-page-link" href={location.pageUrl} target="_blank" rel="noopener noreferrer">{location.pageUrl}<Icon name="external" size={15} /></a> : <p>Page URL unavailable for this finding.</p>}
    {finding.selector && <p className="location-selector">Element: <code>{finding.selector}</code></p>}
    <div className="finding-context-grid"><div className="finding-preview">
    {location.screenshotUrl && !imageFailed ? <figure className="finding-screenshot">
      <a href={location.screenshotUrl} target="_blank" rel="noopener noreferrer" aria-label="Open full screenshot of affected page">
        <img src={location.screenshotUrl} alt={`Captured page containing this finding: ${location.page?.title || location.pageUrl}`} loading="lazy" decoding="async" onError={() => setImageFailed(true)} />
      </a>
      <figcaption>Page capture. Element not highlighted. <a href={location.screenshotUrl} target="_blank" rel="noopener noreferrer">Open full screenshot</a></figcaption>
    </figure> : <p className="location-context">{imageFailed ? 'The saved screenshot could not be loaded.' : 'No screenshot was captured for this page state.'}</p>}
    {location.page && <p className="location-context">Captured {humanDate(location.page.capturedAt)}</p>}
    </div>{children && <div className="finding-guidance">{children}</div>}</div>
  </section>;
}
