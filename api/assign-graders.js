/**
 * D.PotD - Grader Assignment Endpoint
 * Automatically assigns pending submissions to available graders
 * 
 * POST /api/assign-graders
 * Body: { 
 *   action: 'auto-assign' | 'manual-assign' | 'get-stats',
 *   submissionId?: string,
 *   graderId?: string,
 *   day?: number
 * }
 */

/**
 * Main API handler
 */
export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { action, submissionId, graderId, day } = req.body;

        // Note: In production, you would use Firebase Admin SDK here
        // For now, this endpoint provides the structure for grader management
        // The actual Firebase operations happen client-side with proper auth

        switch (action) {
            case 'auto-assign':
                // Return instructions for client-side implementation
                return res.status(200).json({
                    success: true,
                    action: 'auto-assign',
                    message: 'Auto-assignment should be performed client-side with Firebase auth',
                    instructions: {
                        step1: 'Fetch all submissions with gradingStatus = "pending"',
                        step2: 'Fetch all users with isGrader = true',
                        step3: 'Count current assignments per grader',
                        step4: 'Assign to grader with lowest workload',
                        step5: 'Update submission with assignedGrader and gradingStatus = "assigned"'
                    }
                });

            case 'manual-assign':
                if (!submissionId || !graderId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Missing submissionId or graderId'
                    });
                }
                return res.status(200).json({
                    success: true,
                    action: 'manual-assign',
                    submissionId,
                    graderId,
                    message: 'Manual assignment should be performed client-side'
                });

            case 'get-stats':
                // Return structure for stats that should be computed client-side
                return res.status(200).json({
                    success: true,
                    action: 'get-stats',
                    message: 'Stats should be computed client-side',
                    statsStructure: {
                        totalSubmissions: 0,
                        pendingGrading: 0,
                        assignedGrading: 0,
                        completedGrading: 0,
                        graderWorkloads: []
                    }
                });

            default:
                return res.status(400).json({
                    success: false,
                    error: 'Invalid action. Use: auto-assign, manual-assign, or get-stats'
                });
        }

    } catch (error) {
        console.error('Assign graders error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to process grader assignment'
        });
    }
}
