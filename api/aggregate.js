// api/aggregate.js — Serverless function that aggregates data from all Supabase projects + GitHub issues
// Uses service_role keys (server-side only, never exposed to frontend)

const PROJECTS = {
  agentlink: {
    url: process.env.AGENTLINK_SUPABASE_URL,
    key: process.env.AGENTLINK_SUPABASE_SERVICE_KEY
  },
  carnicero: {
    url: process.env.CARNICERO_SUPABASE_URL,
    key: process.env.CARNICERO_SUPABASE_SERVICE_KEY
  },
  veritas: {
    url: process.env.VERITAS_SUPABASE_URL,
    key: process.env.VERITAS_SUPABASE_SERVICE_KEY
  }
};

async function supabaseQuery(project, table, query = 'select=count') {
  const { url, key } = PROJECTS[project];
  if (!url || !key) return { error: `${project}: missing credentials` };
  
  try {
    const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}

async function fetchGitHubIssues() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return [];
  
  try {
    const res = await fetch('https://api.github.com/repos/alidavila/pulso-connect-crm/issues?state=open&labels=hds&per_page=20', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'PulsoConnect-CRM'
      }
    });
    if (!res.ok) return [];
    const issues = await res.json();
    return issues.map(i => ({
      number: i.number,
      title: i.title,
      status: i.labels.some(l => l.name === 'done') ? 'done' : 
              i.labels.some(l => l.name === 'in-progress') ? 'progress' : 'pending',
      assignee: i.assignee?.login || 'sin asignar',
      url: i.html_url,
      labels: i.labels.map(l => l.name)
    }));
  } catch (e) {
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
  
  try {
    const [agentlinkJobs, agentlinkContacts, agentlinkContent, githubIssues] = await Promise.all([
      supabaseQuery('agentlink', 'jobs', 'select=status'),
      supabaseQuery('agentlink', 'contacts', 'select=count'),
      supabaseQuery('agentlink', 'content_calendar', 'select=count'),
      fetchGitHubIssues()
    ]);
    
    // Count jobs by status
    const jobsByStatus = {};
    if (Array.isArray(agentlinkJobs)) {
      agentlinkJobs.forEach(j => {
        jobsByStatus[j.status] = (jobsByStatus[j.status] || 0) + 1;
      });
    }
    
    res.json({
      timestamp: new Date().toISOString(),
      systems: {
        agentlink: {
          status: 'online',
          jobs: Object.keys(jobsByStatus).length > 0 ? jobsByStatus : { total: agentlinkJobs?.length || 0 },
          contacts: Array.isArray(agentlinkContacts) ? agentlinkContacts.length : agentlinkContacts?.[0]?.count || '?',
          content: Array.isArray(agentlinkContent) ? agentlinkContent.length : agentlinkContent?.[0]?.count || '?'
        },
        carnicero: { status: 'pending' },
        veritas: { status: 'pending' }
      },
      hds: {
        pending: githubIssues.filter(i => i.status === 'pending').length,
        in_progress: githubIssues.filter(i => i.status === 'progress').length,
        completed: 0
      },
      tasks: githubIssues,
      activity: [
        { time: new Date().toLocaleTimeString('es-VE',{hour:'2-digit',minute:'2-digit'}), icon: '📊', text: `AgentLink: ${agentlinkJobs?.length || 0} jobs` },
        { time: new Date().toLocaleTimeString('es-VE',{hour:'2-digit',minute:'2-digit'}), icon: '🐙', text: `GitHub: ${githubIssues.length} tareas activas` },
        { time: '--', icon: '🔧', text: 'Dashboard + GitHub Issues integrado' }
      ]
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
