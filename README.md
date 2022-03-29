# Mayhem for Code GitHub Action

[![Mayhem for Code](https://drive.google.com/uc?export=view&id=1JXEbfCDMMwwnDaOgs5-XlPWQwZR93fv4)](http://mayhem.forallsecure.com/)

A GitHub Action for using Mayhem for Code to check for reliability, performance and security issues in your application binary (packaged as a containerized [Docker](https://docs.docker.com/get-started/overview/) image).

## About Mayhem for Code

🧪 Modern App Testing: Mayhem for Code is an application security testing tool that catches reliability, performance and security bugs before they hit production.

🧑‍💻 For Developers, by developers: The engineers building software are the best equipped to fix bugs, including security bugs. As engineers ourselves, we're building tools that we wish existed to make our job easier!

🤖 Simple to Automate in CI: Tests belong in CI, running on every commit and PRs. We make it easy, and provide results right in your PRs where you want them. Adding Mayhem for Code to a DevOps pipeline is easy.

Want to try it? [Get started for free](https://forallsecure.com/mayhem-free) today!

## Getting Started

To use the Mayhem for Code GitHub Action, perform the following steps:

1. Create a Mayhem account and copy and paste your account token to GitHub Secrets.

    a. Navigate to [mayhem.forallsecure.com](https://mayhem.forallsecure.com/) to register an account.

    b. Click your profile drop-down and go to *Settings* > *API Tokens* to access your account API token.

    c. Copy and paste your Mayhem token to your [GitHub Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets#creating-encrypted-secrets-for-an-organization).

2. Create a `mayhem.yml` file in your GitHub repository located at:

    ```sh
    .github/workflows/mayhem.yml
    ```

🤔 Still need some help? Take a look at our working mCode Action examples at: [https://github.com/forallsecure/mcode-action-examples](https://github.com/forallsecure/mcode-action-examples).

## Usage

Your `mayhem.yml` file should look like the following:

```yaml
name: Mayhem
on:
  push:
  pull_request:
  workflow_dispatch:

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build:
    name: '${{ matrix.os }} shared=${{ matrix.shared }} ${{ matrix.build_type }}'
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest]
        shared: [false]
        build_type: [Release]
        include:
          - os: ubuntu-latest
            triplet: x64-linux

    steps:
      - uses: actions/checkout@v2

      - name: Log in to the Container registry
        uses: docker/login-action@f054a8b539a109f9f41c372932f1ae047eff08c9
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata (tags, labels) for Docker
        id: meta
        uses: docker/metadata-action@98669ae865ea3cffbcbaa878cf57c20bbf1c6c38
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}

      - name: Build and push Docker image
        uses: docker/build-push-action@ad44023a93711e3deb337508980b4b5e9bcdc5dc
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}

      - name: Start analysis
        uses: ForAllSecure/mcode-action@v1
        with:
          mayhem-token: ${{ secrets.MAYHEM_TOKEN }}
          args: --image ${{ steps.meta.outputs.tags }}
          sarif-output: sarif

      - name: Upload SARIF file(s)
        uses: github/codeql-action/upload-sarif@v1
        with:
          sarif_file: sarif
```

The mCode Action accepts the following inputs:

| Required | Input Name | Type | Description | Default
| --- | --- | --- | --- | ---
| ✔️ | `mayhem-token` | string | Mayhem for Code account token |
|   | `args` | string | Additional arguments such as specifying the `--corpus` directory path |
|   | `sarif-output` | string | Path for generating a SARIF report output file |
|   | `sarif_file` | string | Path for uploading a SARIF report input file to GitHub |

## Reports and GitHub Code Scanning

Mayhem for Code generates [SARIF reports](https://sarifweb.azurewebsites.net/#:~:text=The%20Static%20Analysis%20Results%20Interchange,approved%20as%20an%20OASIS%20standard.) for your application security testing results.

SARIF reports are generated using the `sarif-output` parameter, which specifies an output file path. Similarly, to upload the SARIF report to GitHub, use the `sarif_file` parameter to specify the location of an input SARIF file to upload to GitHub.

```sh
- name: Start analysis
  uses: ForAllSecure/mcode-action@v1
  with:
    mayhem-token: ${{ secrets.MAYHEM_TOKEN }}
    args: --image ${{ steps.meta.outputs.tags }}
    sarif-output: sarif

- name: Upload SARIF file(s)
  uses: github/codeql-action/upload-sarif@v1
  with:
    sarif_file: sarif
```

Once uploaded to GitHub, you can view test results in the `Security` tab of your repository as well as your for your individual pull requests.

![code-scanning-alert](code-scanning-alert.png)

## How to Contribute

Fork this repository and modify the [`main.ts`](src/main.ts) file. Then, re-compile the mCode GitHub Action by executing the following commands at the root of your forked repository:

```sh
npm install ci
yarn run build && yarn run package
```

Finally, submit a pull request for your changes from your forked repository to this repository and we'll review!

## About Us

ForAllSecure was founded with the mission to make the world’s critical software safe. The company has been applying its patented technology from over a decade of CMU research to solving the difficult challenge of making software safer. ForAllSecure has partnered with Fortune 1000 companies in aerospace, automotive and high-tech industries, as well as the US Department of Defense to integrate Mayhem into software development cycles for continuous security. Profitable and revenue-funded, the company is scaling rapidly.

* [https://forallsecure.com/](https://forallsecure.com/)
* [https://forallsecure.com/mayhem-for-code](https://forallsecure.com/mayhem-for-code)