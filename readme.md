# Solana Token Launchpad Backend

Backend API for managing token launches, whitelist access, tiered pricing, referrals, and vesting schedules.

## Overview

This project implements the backend for a token launchpad platform built on Solana. It esposes a REST API that allows users to register, create token launches, manage whitelists, 
and purchase tokens with tiered pricing.

The system also supports referral codes, vesting schedules, and sybil protection to ensure purchase limits are enforced per user rather than per wallet.

The backend is built with Express and Prisma, using PostgreSQL as the database.

## Tech Stack

- Node.js
- Express.js
- TypeScript
- PostgreSQL
- Prisma ORM
- JWT Authentication
- bcryptjs

## Architecture

The API follows a modular route-based structure.

src/
  routes/
  middleware/
  db.ts
  index.ts

Routes handle request validation and responses, while Prisma manages database access.

Authentication is implemented using JWT tokens passed in the Authorization header.

## Database Models

User:
Stores account credentials and created launches.

Launch: 
Represents a token launch event with supply, price, and timing.

Tier: 
Optional tiered pricing configuration.

Whitelist:
Addresses allowed to participate in restricted launches.

Referral:
Referral codes that provide purchase discounts.

Purchase:
Tracks token purchases and transaction signatures.

Vesting:
Defines cliff and vesting schedule for purchased tokens.

## API Endpoints

| Method | Endpoint | Description |
|------|------|------|
| GET | /api/health | Health check |
| POST | /api/auth/register | Register user |
| POST | /api/auth/login | Login |
| POST | /api/launches | Create launch |
| GET | /api/launches | List launches |
| GET | /api/launches/:id | Get launch |
| POST | /api/launches/:id/purchase | Purchase tokens |
| GET | /api/launches/:id/vesting | Get vesting schedule |

## Running Locally

Install dependencies:

npm install

Create environment file:

.env

Example:
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/launchpad"
JWT_SECRET="supersecretkey"

Start the server:

npx prisma generate
npx prisma db push
npm start

Server run on: http://localhost:3000

## Example Request

Register a user:

curl -X POST http://localhost:3000/api/auth/register \
-H "Content-Type: application/json" \
-d '{"email":"test@test.com","password":"pass123","name":"Alice"}'

## Design Decisions

Sybil Protection:
Purchase limits are enforced per user rather than per wallet address.

Atomic Purchases:
Token purchases run inside a Prisma transaction to prevent race conditions.

Computed Launch Status:
Launch status is calculated dynamically based on time and purchased supply.

## Edge Cases Handled

- Purchases rejected before launch start
- Total supply overflow prevention
- Duplicate transaction signatures
- Referral code exhaustion
- Tier pricing overflow handling

### Concurrency Safety

Token purchases run inside a Prisma transaction to prevent race conditions.

This ensures:
- Total supply cannot be oversold
- maxPerWallet cannot be bypassed
- referral usage counts remain accurate

## Future Improvements

- Integrate on-chain Solana transaction verification
- Add admin dashboard
- Rate limiting for API endpoints
- Caching for launch listings

Tested locally on macOS with Node.js v25 and PostgreSQL 16.