-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalWeightKg" REAL NOT NULL,
    "currentWeightKg" REAL NOT NULL,
    "dislikedFoods" TEXT NOT NULL,
    "eatingMode" TEXT NOT NULL DEFAULT 'canteen',
    "morningTime" TEXT NOT NULL,
    "lunchTime" TEXT NOT NULL,
    "eveningTime" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_UserProfile" ("createdAt", "currentWeightKg", "dislikedFoods", "eveningTime", "goalWeightKg", "id", "lunchTime", "morningTime", "updatedAt", "userId") SELECT "createdAt", "currentWeightKg", "dislikedFoods", "eveningTime", "goalWeightKg", "id", "lunchTime", "morningTime", "updatedAt", "userId" FROM "UserProfile";
DROP TABLE "UserProfile";
ALTER TABLE "new_UserProfile" RENAME TO "UserProfile";
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
