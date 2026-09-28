@Library('ci-templates') _

// Delete the 'latest' manifest before each build to avoid Artifactory conflicts.
// Runs on the Jenkins controller before the pod agent starts.
def artifactoryCleanup(String imagePath) {
    try {
        httpRequest(
            url: "https://artifactory.itg.ti.com/artifactory/docker-itsec-iam-local/${imagePath}/latest/manifest.json",
            httpMode: 'DELETE',
            authentication: 'SSP-ARTIFACTORY-CRED',
            validResponseCodes: '100:599'
        )
    } catch (Exception e) {
        echo "Cleanup skipped for ${imagePath}: ${e.message}"
    }
}

artifactoryCleanup('planner/app')
artifactoryCleanup('planner/runner')
artifactoryCleanup('planner/agent-server')

pipeline {
    agent {
        kubernetes {
            cloud 'kubernetes'
            yaml '''
                apiVersion: v1
                kind: Pod
                metadata:
                  name: planner-build
                  namespace: jenkins
                spec:
                  containers:
                  - name: jnlp
                    image: artifactory.itg.ti.com/docker-public-local/jenkins/inbound-agent:latest-jdk21
                  - name: kaniko
                    image: artifactory.itg.ti.com/docker-public-local/kaniko-project/executor:debug
                    resources:
                      requests:
                        cpu: "2000m"
                        memory: "4000Mi"
                        ephemeral-storage: "20Gi"
                    command:
                    - sleep
                    args:
                    - "9000"
                    volumeMounts:
                    - name: kaniko-secret
                      mountPath: /kaniko/.docker
                  restartPolicy: Never
                  volumes:
                  - name: kaniko-secret
                    secret:
                      secretName: dockercred-secret
                      items:
                      - key: .dockerconfigjson
                        path: config.json
            '''
            customWorkspace "/home/jenkins/agent/workspace/planner"
        }
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10', artifactNumToKeepStr: '10'))
    }

    environment {
        ARTIFACTORY_CREDENTIALS = credentials('SSP-ARTIFACTORY-CRED')
        BITBUCKET_CREDENTIALS   = credentials('CODE-REPO-CRED')

        SHORT_SHA      = sh(returnStdout: true, script: 'git rev-parse --short HEAD').trim()
        TAG_VAL        = sh(script: 'date +%Y%m%d.%H%M', returnStdout: true).trim()
        TAG            = "${TAG_VAL}-${SHORT_SHA}"

        REGISTRY       = "artifactory.itg.ti.com/docker-itsec-iam-local/planner"
        WORKSPACE_PATH = "/home/jenkins/agent/workspace/planner"

        GIT_REPO       = "https://bitbucket.itg.ti.com/scm/itd/planner.git"
        DEVCONFIG_REPO = "https://bitbucket.itg.ti.com/scm/itd/vks-dev-config.git"

        EMAIL_TO       = "a1257245@ti.com"
        EMAIL_APPROVAL = "a1257245@ti.com"
    }

    stages {
        stage('SkipCI Check') {
            steps {
                scmSkip(deleteBuild: true, skipPattern: '.*\\[ci skip\\].*')
            }
        }

        stage('Identify Branch') {
            steps {
                script {
                    env.activebranch = env.BRANCH_NAME.split('/')[0]
                }
                echo "Branch: ${env.BRANCH_NAME}  (prefix: ${env.activebranch})"
            }
        }

        stage('Checkout') {
            when {
                expression {
                    env.BRANCH_NAME ==~ /feature\/.*|ch\/.*|release\/.*|hotfix\/.*/
                }
            }
            steps {
                git credentialsId: 'CODE-REPO-CRED',
                    url: env.GIT_REPO,
                    branch: env.BRANCH_NAME
                echo 'Checkout complete'
            }
        }

        // ── Three sequential Kaniko builds ────────────────────────────────────
        // All share the same TAG. The agent-server image is large (~6 GB after
        // layers) so the kaniko container requests 20 Gi ephemeral storage above.

        stage('Build: app') {
            steps {
                container('kaniko') {
                    sh '''/kaniko/executor \
                        --context ${WORKSPACE_PATH} \
                        --dockerfile ${WORKSPACE_PATH}/Dockerfile.internal \
                        --destination ${REGISTRY}/app:${TAG} \
                        --destination ${REGISTRY}/app:latest \
                        --build-arg HTTP_PROXY="http://webproxy.ext.ti.com:80" \
                        --build-arg HTTPS_PROXY="http://webproxy.ext.ti.com:80"'''
                }
            }
        }

        stage('Build: runner') {
            steps {
                container('kaniko') {
                    sh '''/kaniko/executor \
                        --context ${WORKSPACE_PATH}/agent-runner \
                        --dockerfile ${WORKSPACE_PATH}/agent-runner/Dockerfile.internal \
                        --destination ${REGISTRY}/runner:${TAG} \
                        --destination ${REGISTRY}/runner:latest \
                        --build-arg HTTP_PROXY="http://webproxy.ext.ti.com:80" \
                        --build-arg HTTPS_PROXY="http://webproxy.ext.ti.com:80"'''
                }
            }
        }

        stage('Build: agent-server') {
            steps {
                container('kaniko') {
                    sh '''/kaniko/executor \
                        --context ${WORKSPACE_PATH}/agent-runner \
                        --dockerfile ${WORKSPACE_PATH}/agent-runner/Dockerfile.agent-server.internal \
                        --destination ${REGISTRY}/agent-server:${TAG} \
                        --destination ${REGISTRY}/agent-server:latest \
                        --build-arg HTTP_PROXY="http://webproxy.ext.ti.com:80" \
                        --build-arg HTTPS_PROXY="http://webproxy.ext.ti.com:80"'''
                }
            }
        }

        // ── Approval gate (release/* only) ────────────────────────────────────

        stage('Notification for Approval') {
            when {
                expression { env.BRANCH_NAME ==~ /release\/.*/ }
            }
            steps {
                emailext body: '''<a href="${BUILD_URL}input">Click to approve deployment to production</a>''',
                    mimeType: 'text/html',
                    subject: 'APPROVAL RQD [JENKINS] $PROJECT_NAME - #$BUILD_NUMBER',
                    to: "${EMAIL_APPROVAL}",
                    from: 'Jenkins'
            }
        }

        stage('Approval for CD') {
            when {
                expression { env.BRANCH_NAME ==~ /release\/.*/ }
            }
            steps {
                input message: 'Approve deployment to production?', ok: 'Deploy'
            }
        }

        // ── GitOps: update all three newTag: lines in kustomization.yaml ──────

        stage('Trigger CD: DEV') {
            when {
                expression { env.BRANCH_NAME ==~ /feature\/.*|ch\/.*/ }
            }
            steps {
                git credentialsId: 'CODE-REPO-CRED', url: env.DEVCONFIG_REPO

                echo "Updating all three image tags to ${TAG}"
                // Replace every newTag: line in the planner kustomization.
                // All three images (app, runner, agent-server) share the same TAG
                // so a global replacement is correct and safe.
                sh 'sed -i \'s/newTag:.*/newTag: "\'$TAG\'"/\' accounts/dev/namespaces/unip/planner/kustomization.yaml'

                sh 'git config --global user.email "a1257245@ti.com"'
                sh 'git config --global user.name "planner-ci"'
                sh 'git add accounts/dev/namespaces/unip/planner/kustomization.yaml'
                sh 'git commit -m "planner: update images to $TAG [ci skip]"'
                sh '''
                    ENCODED_PASS=$(echo "$BITBUCKET_CREDENTIALS_PSW" | sed \'s|/|%2F|g; s|+|%2B|g; s|@|%40|g\')
                    git push "https://itsec-iam-k8s-bb:${ENCODED_PASS}@bitbucket.itg.ti.com/scm/itd/vks-dev-config.git" master
                '''
            }
        }

        // stage('Trigger CD: PROD') {
        //     when {
        //         expression { env.BRANCH_NAME ==~ /release\/.*|hotfix\/.*/ }
        //     }
        //     steps {
        //         // Clone the prod config repo and patch the same way
        //         git credentialsId: 'CODE-REPO-CRED', url: 'https://bitbucket.itg.ti.com/scm/itd/vks-prod-config.git'
        //         sh 'sed -i \'s/newTag:.*/newTag: "\'$TAG\'"/\' accounts/prod/namespaces/planner/kustomization.yaml'
        //         sh 'git config --global user.email "a1257245@ti.com"'
        //         sh 'git config --global user.name "planner-ci"'
        //         sh 'git add accounts/prod/namespaces/planner/kustomization.yaml'
        //         sh 'git commit -m "planner: update images to $TAG [ci skip]"'
        //         sh '''
        //             ENCODED_PASS=$(echo "$BITBUCKET_CREDENTIALS_PSW" | sed \'s|/|%2F|g; s|+|%2B|g; s|@|%40|g\')
        //             git push "https://itsec-iam-k8s-bb:${ENCODED_PASS}@bitbucket.itg.ti.com/scm/itd/vks-prod-config.git" master
        //         '''
        //     }
        // }
    }

    post {
        failure {
            emailext body: 'Build failed. Check console output at $BUILD_URL\n\n${BUILD_LOG, maxLines=100, escapeHtml=false}',
                to: "${EMAIL_TO}", from: 'Jenkins',
                subject: 'Build failed: $PROJECT_NAME - #$BUILD_NUMBER'
        }
        unstable {
            emailext body: 'Unstable build. Check $BUILD_URL\n\n${BUILD_LOG, maxLines=100, escapeHtml=false}',
                to: "${EMAIL_TO}", from: 'Jenkins',
                subject: 'Unstable: $PROJECT_NAME - #$BUILD_NUMBER'
        }
        changed {
            emailext body: 'Build is back to normal: $BUILD_URL',
                to: "${EMAIL_TO}", from: 'Jenkins',
                subject: 'Back to normal: $PROJECT_NAME - #$BUILD_NUMBER'
        }
        success {
            emailext body: 'Build successful. Images tagged ${TAG}. Check $BUILD_URL',
                to: "${EMAIL_TO}", from: 'Jenkins',
                subject: 'Build successful: $PROJECT_NAME - #$BUILD_NUMBER'
        }
    }
}
