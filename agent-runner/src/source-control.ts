export interface ReviewState {
  state: 'open' | 'closed'
  merged: boolean
  mergedAt: string | null
}

export interface ReviewDetails {
  number: number
  url: string
  body: string
  draft: boolean
  headSha: string
  headRef: string
  baseRef: string
}

export interface CreateReviewInput {
  head: string
  title: string
  body: string
  draft?: boolean
}

export interface CreatedReview {
  number: number
  url: string
}

export interface SourceControlAdapter {
  readonly provider: 'github' | 'bitbucket_data_center'
  gitEnvironment: (repoUrl: string) => NodeJS.ProcessEnv
  pushBranch: (repoDir: string, branchName: string) => Promise<void>
  getReviewState: (reviewUrl: string) => Promise<ReviewState | null>
  getReviewDetails: (reviewUrl: string) => Promise<ReviewDetails>
  listReviewCommitShas: (reviewUrl: string) => Promise<string[]>
  listReviewFilePaths: (reviewUrl: string) => Promise<string[]>
  reviewFileUrl: (
    reviewUrl: string,
    commitSha: string,
    path: string,
    raw?: boolean,
  ) => string
  updateReviewBody: (reviewUrl: string, body: string) => Promise<void>
  createReviewForBranch: (
    repoUrl: string,
    input: CreateReviewInput,
  ) => Promise<CreatedReview>
}
