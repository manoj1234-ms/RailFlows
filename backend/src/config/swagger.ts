export const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'RailFlow API',
    version: '2.1.0',
    description: 'High-Scale Intelligent Ticket Booking Platform API',
    contact: {
      name: 'RailFlow Support',
      email: 'support@railflow.com',
    },
  },
  servers: [
    { url: '/api/v1', description: 'API v1' },
    { url: '/api', description: 'Legacy API' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['Guest', 'Passenger', 'Agent', 'Operator', 'Admin', 'Super Admin'] },
          name: { type: 'string' },
          phone: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Train: {
        type: 'object',
        properties: {
          trainNumber: { type: 'string' },
          name: { type: 'string' },
          fromStation: { type: 'string' },
          toStation: { type: 'string' },
          departureTime: { type: 'string' },
          arrivalTime: { type: 'string' },
          baseFare: { type: 'number' },
          availableSeatsCount: { type: 'integer' },
        },
      },
      Booking: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          pnr: { type: 'string' },
          status: { type: 'string', enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'REFUNDED'] },
          price: { type: 'number' },
          trainNumber: { type: 'string' },
          passengers: { type: 'array', items: { type: 'object' } },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      QueueToken: {
        type: 'object',
        properties: {
          token: { type: 'string' },
          userId: { type: 'integer' },
          currentPosition: { type: 'integer' },
          estimatedWaitSeconds: { type: 'integer' },
          bookingWindowExpiresAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      Payment: {
        type: 'object',
        properties: {
          transactionId: { type: 'string' },
          amount: { type: 'number' },
          paymentMethod: { type: 'string' },
          status: { type: 'string', enum: ['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED'] },
        },
      },
      Error: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'error' },
          message: { type: 'string' },
        },
      },
    },
  },
  paths: {
    '/auth/register': {
      post: {
        tags: ['Authentication'],
        summary: 'Register a new user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'role'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                  role: { type: 'string', enum: ['Passenger', 'Agent'] },
                  name: { type: 'string' },
                  phone: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'User registered successfully' },
          '400': { description: 'Validation error or email exists' },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Login with email and password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Login successful, returns tokens' },
          '401': { description: 'Invalid credentials' },
          '403': { description: 'MFA required' },
        },
      },
    },
    '/trains/search': {
      get: {
        tags: ['Trains'],
        summary: 'Search trains with fuzzy station matching',
        parameters: [
          { name: 'from', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'to', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
        ],
        responses: {
          '200': { description: 'List of matching trains', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Train' } } } } },
        },
      },
    },
    '/trains/{number}': {
      get: {
        tags: ['Trains'],
        summary: 'Get train details by number',
        parameters: [
          { name: 'number', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Train details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Train' } } } },
          '404': { description: 'Train not found' },
        },
      },
    },
    '/trains/{number}/coach': {
      get: {
        tags: ['Trains'],
        summary: 'Get coach layout with seat availability',
        parameters: [
          { name: 'number', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'class', in: 'query', required: true, schema: { type: 'string', enum: ['1A', '2A', '3A', 'SL', 'CC'] } },
        ],
        responses: {
          '200': { description: 'Coach layout with seats' },
        },
      },
    },
    '/queue/join': {
      post: {
        tags: ['Queue'],
        summary: 'Join the virtual booking queue',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['deviceFingerprint'],
                properties: {
                  deviceFingerprint: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Queue token issued', content: { 'application/json': { schema: { $ref: '#/components/schemas/QueueToken' } } } },
          '401': { description: 'Authentication required' },
        },
      },
    },
    '/queue/status': {
      get: {
        tags: ['Queue'],
        summary: 'Poll current queue position',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'token', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'deviceFingerprint', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Current queue status' },
        },
      },
    },
    '/bookings/lock': {
      post: {
        tags: ['Bookings'],
        summary: 'Lock seats for booking (requires queue access)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['trainNumber', 'coachLabel', 'seatNumbers'],
                properties: {
                  trainNumber: { type: 'string' },
                  coachLabel: { type: 'string' },
                  seatNumbers: { type: 'array', items: { type: 'integer' } },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Seats locked successfully' },
          '403': { description: 'Queue access required' },
        },
      },
    },
    '/bookings/confirm': {
      post: {
        tags: ['Bookings'],
        summary: 'Confirm booking (saga orchestrator with payment)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['trainNumber', 'coachLabel', 'seatNumbers', 'passengers', 'paymentMethod'],
                properties: {
                  trainNumber: { type: 'string' },
                  coachLabel: { type: 'string' },
                  seatNumbers: { type: 'array', items: { type: 'integer' } },
                  passengers: { type: 'array', items: { type: 'object' } },
                  paymentMethod: { type: 'string' },
                  idempotencyKey: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Booking confirmed' },
          '409': { description: 'Idempotency conflict' },
        },
      },
    },
    '/bookings/history': {
      get: {
        tags: ['Bookings'],
        summary: 'Get booking history for authenticated user',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'List of bookings' },
        },
      },
    },
    '/bookings/ticket/{pnr}': {
      get: {
        tags: ['Bookings'],
        summary: 'Retrieve e-ticket by PNR',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'pnr', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'E-ticket PDF/info' },
          '404': { description: 'Booking not found' },
        },
      },
    },
    '/payments/methods': {
      get: {
        tags: ['Payments'],
        summary: 'Get available payment methods',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'List of payment methods' },
        },
      },
    },
    '/users/profile': {
      get: {
        tags: ['Users'],
        summary: 'Get authenticated user profile',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'User profile', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
        },
      },
    },
    '/users/passengers': {
      get: {
        tags: ['Users'],
        summary: 'Get saved passengers with masked Aadhaar',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'List of saved passengers' },
        },
      },
      post: {
        tags: ['Users'],
        summary: 'Add a saved passenger',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'aadhaar'],
                properties: {
                  name: { type: 'string' },
                  aadhaar: { type: 'string', description: 'Will be encrypted at rest' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Passenger added' },
        },
      },
    },
    '/admin/analytics': {
      get: {
        tags: ['Admin'],
        summary: 'Get booking analytics dashboard',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Analytics data' },
        },
      },
    },
    '/admin/queue-metrics': {
      get: {
        tags: ['Admin'],
        summary: 'Get virtual queue metrics',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Queue metrics' },
        },
      },
    },
    '/admin/service-health': {
      get: {
        tags: ['Admin'],
        summary: 'Get service health grid',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Service health metrics' },
        },
      },
    },
    '/admin/audit-logs': {
      get: {
        tags: ['Admin'],
        summary: 'Get security audit logs',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Audit logs' },
        },
      },
    },
    '/stations': {
      get: {
        tags: ['Stations'],
        summary: 'Get all stations',
        responses: {
          '200': { description: 'List of stations' },
        },
      },
    },
    '/events': {
      get: {
        tags: ['Events'],
        summary: 'Get all events',
        responses: {
          '200': { description: 'List of events' },
        },
      },
    },
  },
};
