# RailFlow Local Pipeline Promotion & Verification Script
# This script automates running the test suite on 'develop', checking out 'test' branch, 
# merging if clean, running tests again, and merging to 'main' (production).

$ErrorActionPreference = "Stop"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "   RailFlow Local CI/CD Pipeline Simulator   " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# 1. Check current git branch
$currentBranch = (git branch --show-current).Trim()
Write-Host "Current branch: $currentBranch" -ForegroundColor Yellow

if ($currentBranch -ne "develop") {
    Write-Host "[WARNING] It is recommended to start this script on the 'develop' branch." -ForegroundColor Red
    $choice = Read-Host "Do you want to switch to 'develop' branch? (Y/N)"
    if ($choice.ToUpper() -eq "Y") {
        git checkout develop
        $currentBranch = "develop"
    } else {
        Write-Host "Exiting script. Please switch to develop and retry." -ForegroundColor Yellow
        exit
    }
}

# 2. Run backend tests
Write-Host "`nStep 1: Running unit & integration tests on 'develop' branch..." -ForegroundColor Cyan
Push-Location backend
try {
    npm test
} catch {
    Write-Host "`n[ERROR] Tests failed on 'develop' branch. Fix failures before merging." -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

Write-Host "`n[SUCCESS] All tests passed on 'develop' branch!" -ForegroundColor Green

# 3. Ask to promote to 'test' branch
$promoteToTest = Read-Host "Do you want to merge 'develop' into 'test' branch? (Y/N)"
if ($promoteToTest.ToUpper() -ne "Y") {
    Write-Host "Exiting pipeline simulation." -ForegroundColor Yellow
    exit
}

# Ensure local 'test' branch exists
$branches = git branch
$hasTestBranch = $branches -match "test"
if (-not $hasTestBranch) {
    Write-Host "Creating 'test' branch..." -ForegroundColor Gray
    git branch test
}

Write-Host "`nStep 2: Switching to 'test' branch and merging 'develop'..." -ForegroundColor Cyan
git checkout test
try {
    git merge develop -m "Merge branch 'develop' into test [Local Verification Passed]"
} catch {
    Write-Host "[ERROR] Git merge conflict. Resolve manually." -ForegroundColor Red
    exit 1
}

# 4. Run tests on 'test' branch to ensure staging is clean
Write-Host "`nStep 3: Verifying test suite on staging ('test' branch)..." -ForegroundColor Cyan
Push-Location backend
try {
    npm test
} catch {
    Write-Host "[ERROR] Tests failed on staging ('test' branch)! Reverting merge." -ForegroundColor Red
    Pop-Location
    git reset --hard HEAD~1
    git checkout develop
    exit 1
}
Pop-Location

Write-Host "`n[SUCCESS] Staging ('test' branch) verification completed successfully!" -ForegroundColor Green

# 5. Ask to promote to 'main' (production)
$promoteToMain = Read-Host "Do you want to merge 'test' into 'main' (production)? (Y/N)"
if ($promoteToMain.ToUpper() -ne "Y") {
    Write-Host "Switching back to 'develop' branch..." -ForegroundColor Gray
    git checkout develop
    exit
}

Write-Host "`nStep 4: Switching to 'main' branch and merging 'test'..." -ForegroundColor Cyan
git checkout main
try {
    git merge test -m "Merge branch 'test' into main [Production Approved]"
} catch {
    Write-Host "[ERROR] Merge conflicts while merging to main. Resolve manually." -ForegroundColor Red
    exit 1
}

Write-Host "`nStep 5: Compiling production build check..." -ForegroundColor Cyan
Push-Location backend
try {
    npx tsc --noEmit
    Write-Host "[SUCCESS] TypeScript compilation check passed!" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Production build compilation failed! Reverting production merge." -ForegroundColor Red
    Pop-Location
    git reset --hard HEAD~1
    git checkout develop
    exit 1
}
Pop-Location

Write-Host "`n=============================================" -ForegroundColor Green
Write-Host "    Pipeline Completed & Production Merged   " -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green

git checkout develop
Write-Host "Switched back to 'develop' branch for continued work." -ForegroundColor Gray
