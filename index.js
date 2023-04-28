import { URL } from 'url'

export async function runEveryMinute(meta) {
    
    const activeIncidentKey = await meta.cache.get("ilert_active_alert")
    
    const events = await getTrend(meta)
    const isInError = await isTrendError(meta, events)

    if (activeIncidentKey && !isInError) {
        await resolveAlert(meta, events)
        console.log('Resolved ilert alert', activeIncidentKey)
    } else if (!activeIncidentKey && isInError) {
        const key = await triggerAlert(meta, events)
        console.log('Triggered ilert alert', key)
    } else if (isInError) {
        console.log('Ingestion alert is already active')
    } else {
        console.log('Ingestion OK')
    }
}

async function isTrendError(meta, events) {

    if(events.filters.insight !== "TRENDS") {
        throw "The provided insight is not a trend"
    }

    const result = events.result?.[0]

    if(!result) {
        console.warn("Insight returned no result")
        return
    } else if(result.data.length === 0) {
        console.warn("Insight returned no data")
        return
    }

    const latestDataPoint = result.data.slice(-1)

    return dataPointInError(latestDataPoint, parseFloat(meta.config.threshold), meta.config.operator)

}

async function getTrend(meta) {

    const insightId = insightIdFromUrl(meta.config.posthogTrendUrl)

    const apiUrl = new URL(
        `/api/projects/${meta.config.posthogProjectId}/insights?short_id=${insightId}`,
        meta.config.posthogTrendUrl
    )

    const response = await fetch(apiUrl, {
        headers: {
            authorization: `Bearer ${meta.config.posthogApiKey}`
        }
    })

    if (!response.ok) {
        throw Error(`Error from PostHog API: status=${response.status} response=${await response.text()}`)
    }

    const { results } = await response.json()

    return results[0]
}

async function triggerAlert(meta, events) {
    let key = events.id
    await triggerIlert(meta, 'alert', events)
    await meta.cache.set("ilert_active_alert", key)
    return key
}

async function resolveAlert(meta, events) {
    await triggerIlert(meta, 'resolved', events)
    await meta.cache.set("ilert_active_alert", null)
}

async function triggerIlert(meta, status, events){

    const result = events.result?.[0]
    const latestDataPoint = result.data.slice(-1)[0].toString()

    var url = "https://api.ilert.com/api/v1/events/posthog/" + meta.config.ilertApiKey;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            'id': events.id,
            'shortId': events.short_id,
            'status': status,
            'derivedName': events.derived_name,
            'summary': meta.config.ilertAlertSummary,
            'details': meta.config.ilertAlertDetails,
            'description': events.description,
            'lastRefresh': events.last_refresh,
            'data': {
                "latestDataPoint": latestDataPoint,
                "operator": meta.config.operator[0],
                "threshold": meta.config.threshold,
            },
            'createdAt': events.created_at,
            'createdBy': {
                'id': events.created_by.id,
                'firstName': events.created_by.first_name,
                'email': events.created_by.email
            },
            'lastModifiedBy': {
                'id': events.last_modified_by.id,
                'firstName': events.last_modified_by.first_name,
                'email': events.last_modified_by.email
            },
            'links': [
                {
                    "url": meta.config.posthogTrendUrl,
                    "text": "Posthog Trends API query url"
                }
            ]
        })
    })
    
    if (!response.ok) {
        throw Error(`Error from ilert: status=${response.status} response=${await response.text()}`)
    }

    return response
}

function dataPointInError(value, threshold, operator) {
    if (operator.startsWith('≤')) {
        return value <= threshold
    } else {
        return value >= threshold
    }
}

function insightIdFromUrl(trendsUrl) {
    const url = new URL(trendsUrl)

    if (url.pathname.startsWith('/insights')) {
        const [_, insightId] = /\/insights\/([a-zA-Z0-9]*)$/.exec(url.pathname)

        if(!insightId) {
            throw Error(`Not a valid trends URL: ${trendsUrl}`)
        }

        return insightId
    }

    throw Error(`Not a valid trends URL: ${trendsUrl}`)
}
