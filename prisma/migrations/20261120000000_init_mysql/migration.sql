-- CreateTable
CREATE TABLE `admins` (
    `id` CHAR(36) NOT NULL,
    `username` VARCHAR(50) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admins_username_key`(`username`),
    UNIQUE INDEX `admins_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `csrfHash` CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    `adminId` CHAR(36) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sessions_tokenHash_key`(`tokenHash`),
    INDEX `sessions_adminId_idx`(`adminId`),
    INDEX `sessions_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `slug` VARCHAR(160) NOT NULL,
    `description` TEXT NOT NULL,
    `category` VARCHAR(80) NOT NULL,
    `imageUrl` VARCHAR(2048) NOT NULL,
    `imageFilename` VARCHAR(255) NULL,
    `price` DECIMAL(10, 2) NULL,
    `displayOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `products_slug_key`(`slug`),
    INDEX `products_category_idx`(`category`),
    INDEX `products_isActive_displayOrder_idx`(`isActive`, `displayOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `services` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `slug` VARCHAR(160) NOT NULL,
    `description` TEXT NOT NULL,
    `category` VARCHAR(80) NOT NULL,
    `imageUrl` VARCHAR(2048) NOT NULL,
    `imageFilename` VARCHAR(255) NULL,
    `price` DECIMAL(10, 2) NULL,
    `displayOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `services_slug_key`(`slug`),
    INDEX `services_category_idx`(`category`),
    INDEX `services_isActive_displayOrder_idx`(`isActive`, `displayOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `admins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce non-negative pricing (preserved invariant; MariaDB 11 enforces CHECK).
ALTER TABLE `products` ADD CONSTRAINT `products_price_non_negative` CHECK (`price` IS NULL OR `price` >= 0);
ALTER TABLE `services` ADD CONSTRAINT `services_price_non_negative` CHECK (`price` IS NULL OR `price` >= 0);