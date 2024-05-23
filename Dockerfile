FROM node:20

ARG SRCDIR=/workdir

RUN mkdir -p ${SRCDIR}

WORKDIR ${SRCDIR}

COPY . .

RUN yarn install
